/**
 * The copy for `/ki` — how to connect hendingar.no to an assistant over MCP (ADR 0024).
 *
 * The setup steps name other companies' menus, which move. They are written as loosely as still
 * gets somebody there, and the address itself is the one part that must be exact — the page
 * renders that from the request, not from here.
 */

export type Client = {
	name: string;
	/** What to do, in order. The address is shown separately, once, above all of them. */
	steps: string[];
	/** A command or config to copy, with `{url}` standing for the server's address. */
	snippet?: string;
};

export const CLIENTS: Client[] = [
	{
		name: 'Claude',
		steps: [
			'Opne innstillingane, og finn «Connectors» (koplingar).',
			'Vel «Add custom connector», gi han namnet hendingar og lim inn adressa.',
			'Spør til dømes: «Kva skjer på Stord i helga?»'
		]
	},
	{
		name: 'ChatGPT',
		steps: [
			'Slå på utviklarmodus under «Apps & Connectors» i innstillingane.',
			'Lag ei ny kopling med adressa over, utan innlogging.'
		]
	},
	{
		name: 'Claude Code',
		steps: ['Køyr dette i terminalen:'],
		snippet: 'claude mcp add --transport http hendingar {url}'
	},
	{
		name: 'Cursor, VS Code og andre',
		steps: [
			'Legg til ein MCP-tenar av typen HTTP med adressa over. I ei mcp.json ser det slik ut:'
		],
		snippet: '{\n\t"mcpServers": {\n\t\t"hendingar": { "url": "{url}" }\n\t}\n}'
	}
];

/** What an assistant can ask, in the words a reader would use. Mirrors the tool list. */
export const CAN_ASK: string[] = [
	'Søkje i alle komande hendingar, etter ord, kategori, stad, kjelde eller tidsrom',
	'Hente ei hending i sin heilskap — skildring, adresse, billettlenkje og kvar ho kom frå',
	'Ein bestemt dag, denne eller neste helg, eller ei heil veke',
	'Kva dagar det skjer mest, månad for månad',
	'Faste aktivitetar med timeplan, og stader som alltid er opne',
	'Kuratoren sine tre val for helga, med grunngjeving',
	'Kva kjelder vi hentar frå, og når dei sist vart henta',
	'Vise det han tilrår som kort med plakat, tid, stad og knappar for kalender og billettar — i assistentar som kan teikne dei'
];

/** The promises. Each is enforced in code, and the ADR says where. */
export const PROMISES: string[] = [
	'Berre lesing. Ein assistent kan ikkje sende inn, endre eller hjarte noko. Vil du leggje til ei hending, gjer du det på /send-inn.',
	'Ingen innlogging og ingen nøkkel. Det er dei same opplysningane som står på sida.',
	'Vi lagrar ikkje kva assistenten spør etter — ikkje søkjeorda, ikkje kva hending, ikkje kven.',
	'Kvar hending kjem med lenkja si hit og namnet på kjelda, så svaret alltid kan sjekkast.'
];
