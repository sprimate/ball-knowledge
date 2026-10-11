# Ball Knowledge: static Vite site served by nginx. Built by the central pipeline (.conductor/project.json) with the
# repo root as context.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The repo builds for GitHub Pages (base /ball-knowledge/); on our own hostname it lives at /.
RUN npx tsc && npx vite build --base=/

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/ball-knowledge/nginx.conf /etc/nginx/conf.d/default.conf
