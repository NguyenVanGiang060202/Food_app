FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY crawler/package.json crawler/package.json
RUN npm ci
COPY backend backend
RUN npm run build --workspace backend

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/backend/dist backend/dist
EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
