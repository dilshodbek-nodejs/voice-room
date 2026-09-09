FROM node:20-alpine AS build
WORKDIR /srv
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /srv
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /srv/dist ./dist
EXPOSE 2021
CMD ["node", "dist/server.js"]
