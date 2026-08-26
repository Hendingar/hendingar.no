# Plain Dockerfile, no Azure-specific anything — the portability requirement from ADR 0002.
# Runs anywhere that can run a container with a DATABASE_URL.

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

# Manifests first, so dependency installs cache independently of source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY app/package.json ./app/
COPY packages/core/package.json ./packages/core/
RUN pnpm install --frozen-lockfile

COPY . .

# src/env.ts validates DATABASE_URL, and SvelteKit runs that validation while analysing routes at
# build time as well as at startup. The variable is non-static (read from the environment when the
# app starts), so this placeholder is NOT baked into the bundle — it only satisfies the build.
# The real value is validated for real when the container boots.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN pnpm --filter @hendingar/app build

# Collect a self-contained tree: workspace deps resolved, dev deps dropped.
RUN pnpm deploy --legacy --filter=@hendingar/app --prod /app-deploy


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# adapter-node reads PORT; Container Apps expects the app to listen on this.
ENV PORT=8080

COPY --from=build /app-deploy/node_modules ./node_modules
COPY --from=build /app-deploy/package.json ./package.json
COPY --from=build /repo/app/build ./build

USER node
EXPOSE 8080
CMD ["node", "build"]
