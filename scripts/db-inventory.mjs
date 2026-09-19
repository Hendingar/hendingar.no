/*
 * Every local hendingar database, and which worktree claims it.
 *
 * `.superset/teardown.sh` closes a worktree's database when the worktree goes, but only Superset
 * calls it, and only for the workspaces it created. A worktree made by hand — `git worktree add`,
 * or one of the agent worktrees under `.claude/worktrees/` — leaves its container running and its
 * volume on disk forever. On this machine that had already cost a Postgres running since a branch
 * that merged three days earlier, and a volume whose container was long gone.
 *
 * You cannot tell from `container ls` which of those is still wanted: the slug is a hash of a
 * path, so the name says nothing about whether anyone still needs it. So ask the worktrees
 * instead. Each one names its container and volume in its own `.env`, which makes "claimed" a
 * fact rather than a guess — and makes the shared default visible, because a worktree that never
 * ran `.superset/setup.sh` claims `hendingar-db`, and several worktrees claiming it at once is
 * exactly the arrangement where one `pnpm db:reset` destroys the others.
 *
 * Usage: node scripts/db-inventory.mjs report|plan
 *   report  the table, for `pnpm db:ls`
 *   plan    one `<kind>\t<name>` line per unclaimed container/volume, for `db.sh reap`
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONTAINER_PREFIX = 'hendingar-db';
const VOLUME_PREFIX = 'hendingar-pgdata';

/** Never throws: a missing `container` CLI or a stopped runtime should print an empty table. */
function capture(file, args) {
	try {
		return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return '';
	}
}

function envValue(text, key) {
	// Last assignment wins, the same way dotenv and `set -a; . .env` read it.
	const matches = [...text.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))];
	return matches.length ? matches[matches.length - 1][1].trim() : '';
}

function worktreePaths() {
	const porcelain = capture('git', ['-C', root, 'worktree', 'list', '--porcelain']);
	return [...porcelain.matchAll(/^worktree (.*)$/gm)].map((m) => m[1]);
}

/** worktree path -> the container and volume its .env names, defaults included. */
function claims() {
	const paths = worktreePaths();

	const byContainer = new Map();
	const byVolume = new Map();

	for (const path of paths) {
		if (!existsSync(path)) continue;
		let text = '';
		try {
			text = readFileSync(join(path, '.env'), 'utf8');
		} catch {
			// No .env at all — still a claim on the shared default, which is the interesting case.
		}
		const container = envValue(text, 'DB_CONTAINER_NAME') || CONTAINER_PREFIX;
		const volume = envValue(text, 'DB_VOLUME') || VOLUME_PREFIX;

		if (!byContainer.has(container)) byContainer.set(container, []);
		byContainer.get(container).push(path);
		if (!byVolume.has(volume)) byVolume.set(volume, []);
		byVolume.get(volume).push(path);
	}

	return { byContainer, byVolume };
}

function containers() {
	let entries = [];
	try {
		entries = JSON.parse(capture('container', ['ls', '--all', '--format', 'json']) || '[]');
	} catch {
		return new Map();
	}

	const found = new Map();
	for (const entry of entries) {
		const config = entry.configuration ?? entry;
		const name = config.id ?? '';
		if (!name.startsWith(CONTAINER_PREFIX)) continue;
		found.set(name, {
			state: typeof entry.status === 'string' ? entry.status : 'running',
			ports: (config.publishedPorts ?? []).map((p) => String(p.hostPort)).join(',') || '-'
		});
	}
	return found;
}

function volumes() {
	return capture('container', ['volume', 'ls'])
		.split('\n')
		.slice(1)
		.map((line) => line.trim().split(/\s+/)[0])
		.filter((name) => name && name.startsWith(VOLUME_PREFIX));
}

// `~/…` rather than a bare relative path: these lines get pasted into a shell, from a cwd that
// is not the home directory.
const short = (path) =>
	path.startsWith(homedir() + '/') ? '~' + path.slice(homedir().length) : path;

/*
 * Worktrees whose work has landed and which hold nothing uncommitted.
 *
 * `git merge-base --is-ancestor` is not enough on its own here: PRs are squash-merged, so a
 * landed branch shares no commit with main and its HEAD is not an ancestor of anything. What it
 * does leave behind is an upstream that no longer exists — `[origin/…: gone]` — which is the
 * reliable signal that the PR merged and GitHub deleted the branch. Take either.
 *
 * Reported only, never acted on. A worktree is someone's open editor.
 */
function finished() {
	// paths[0] is the primary checkout; it is never a thing to close down.
	const out = [];

	for (const path of worktreePaths().slice(1)) {
		if (!existsSync(path) || path === root) continue;

		const dirty = capture('git', ['-C', path, 'status', '--porcelain']).trim();
		if (dirty) continue;

		const head = capture('git', ['-C', path, 'rev-parse', 'HEAD']).trim();
		if (!head) continue;

		let landed = false;
		try {
			execFileSync('git', ['-C', path, 'merge-base', '--is-ancestor', head, 'origin/main'], {
				stdio: 'ignore'
			});
			landed = true;
		} catch {
			// Not an ancestor — which a squash-merge guarantees. Fall through to the upstream test.
		}

		const branch = capture('git', ['-C', path, 'branch', '--show-current']).trim();
		if (!landed && branch) {
			const upstream = capture('git', [
				'-C',
				path,
				'for-each-ref',
				'--format=%(upstream:track)',
				`refs/heads/${branch}`
			]).trim();
			landed = upstream === '[gone]';
		}

		if (landed) out.push({ path, branch: branch || 'detached HEAD' });
	}

	return out;
}

function report() {
	const { byContainer, byVolume } = claims();
	const live = containers();

	const names = [...new Set([...live.keys(), ...byContainer.keys()])].sort();
	const rows = names.map((name) => ({
		name,
		...(live.get(name) ?? { state: '(no container)', ports: '-' }),
		owners: byContainer.get(name) ?? []
	}));

	const width = Math.max(9, ...rows.map((r) => r.name.length));
	const pad = (s, n) => String(s).padEnd(n);

	console.log();
	console.log(`  ${pad('CONTAINER', width)}  ${pad('STATE', 13)} ${pad('PORT', 5)}  CLAIMED BY`);
	for (const { name, state, ports, owners } of rows) {
		let who;
		if (owners.length === 0) who = 'ORPHAN — no worktree claims it';
		else if (owners.length === 1) who = short(owners[0]);
		else who = `${owners.length} worktrees SHARE this:`;
		console.log(`  ${pad(name, width)}  ${pad(state, 13)} ${pad(ports, 5)}  ${who}`);
		// One per line when there are several: the whole point of the row is that the list is
		// too long, and wrapping it into the terminal's margin hides exactly that.
		if (owners.length > 1) {
			for (const owner of owners)
				console.log(`  ${' '.repeat(width)}  ${' '.repeat(21)}${short(owner)}`);
		}
	}

	const orphanVolumes = volumes().filter((v) => !byVolume.has(v));
	if (orphanVolumes.length) {
		console.log();
		console.log('  Volumes no worktree claims (the data outlived its container):');
		for (const v of orphanVolumes) console.log(`    ${v}`);
	}

	if (rows.some((r) => r.owners.length > 1)) {
		console.log();
		console.log('  Worktrees sharing one database: `pnpm db:reset` in any of them destroys the');
		console.log('  data of all of them. Give each its own with:  ./.superset/setup.sh');
	}

	const done = finished();
	if (done.length) {
		console.log();
		console.log('  Finished worktrees — nothing uncommitted, and the branch is either in main');
		console.log('  already or gone from the remote (which is what a squash-merge leaves):');
		for (const { path, branch } of done) console.log(`    ${short(path)}  (${branch})`);
		console.log();
		console.log('  Close one down — the worktree first, so its database stops being claimed:');
		console.log(`    git worktree remove ${short(done[0].path)} && pnpm db:reap --yes`);
		console.log();
		console.log('  `git worktree remove` keeps the local branch, so no commit is lost either way.');
	}

	if (rows.some((r) => r.owners.length === 0) || orphanVolumes.length) {
		console.log();
		console.log('  Remove what nothing claims:  pnpm db:reap');
	}
	console.log();
}

/*
 * Deliberately narrow. "No worktree claims it" is a fact; "looks finished" is a guess, and the
 * guess is the one that deletes a database someone was still using. A finished worktree that
 * still exists keeps its database until someone removes the worktree.
 */
function plan() {
	const { byContainer, byVolume } = claims();
	const lines = [];
	for (const name of containers().keys()) {
		if (!byContainer.has(name)) lines.push(`container\t${name}`);
	}
	for (const name of volumes()) {
		if (!byVolume.has(name)) lines.push(`volume\t${name}`);
	}
	if (lines.length) console.log(lines.join('\n'));
}

const mode = process.argv[2];
if (mode === 'report') report();
else if (mode === 'plan') plan();
else {
	console.error('usage: node scripts/db-inventory.mjs report|plan');
	process.exit(2);
}
