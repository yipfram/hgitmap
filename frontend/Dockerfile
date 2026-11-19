FROM node:22-alpine AS build
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY . .
# Placeholder replaced at container start by docker-entrypoint.sh
ENV VITE_API_URL=__VITE_API_URL__
RUN npm run build

FROM nginx:alpine
RUN printf 'server {\n listen 80;\n root /usr/share/nginx/html;\n index index.html;\n location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.d/40-api-url.sh
RUN chmod +x /docker-entrypoint.d/40-api-url.sh
EXPOSE 80
