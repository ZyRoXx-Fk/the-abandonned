FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN npm install --global pnpm@12.6.0 --ignore-scripts
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# Public MCP URLs are compiled into the static site; never supply secrets here.
ARG PUBLIC_MCP_CLIENT_URL
ARG PUBLIC_MCP_BUSINESS_URL
ENV PUBLIC_API_BASE_URL=/ \
    PUBLIC_MCP_CLIENT_URL=${PUBLIC_MCP_CLIENT_URL} \
    PUBLIC_MCP_BUSINESS_URL=${PUBLIC_MCP_BUSINESS_URL}
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
COPY tests ./tests
RUN pnpm test && pnpm build

FROM nginx/nginx-unprivileged:stable-alpine AS runtime
ENV PORT=8080 \
    BACKEND_ORIGIN=https://relay-backend-latest.onrender.com \
    NGINX_ENVSUBST_FILTER="^(PORT|BACKEND_ORIGIN)$"

COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

USER 101
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
