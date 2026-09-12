FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/app/package.json apps/app/package.json
RUN npm ci

COPY apps/app apps/app

# Baked into the client bundle at build time by Vite (browser can't reach "localhost:8787" on the server).
# Reverse proxy exposes the API under /api/, so a relative URL works regardless of domain.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build --workspace=@jj-tool/app

FROM nginx:alpine AS runtime
COPY --from=build /repo/apps/app/dist /usr/share/nginx/html
COPY apps/app/nginx.spa.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
