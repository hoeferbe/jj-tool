FROM node:24-alpine AS build
WORKDIR /repo
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/app/package.json apps/app/package.json
RUN npm ci

COPY apps/api apps/api
RUN npm run build --workspace=@jj-tool/api

FROM node:24-alpine AS runtime
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist

EXPOSE 8787
CMD ["node", "dist/index.js"]
