# Estágio 1: Build (BD-Perfect - variáveis VITE_* congeladas no build time)
FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_WEBHOOK_SEND_MESSAGE
ARG VITE_WEBHOOK_BULK_SEND
ARG VITE_EVOLUTION_INSTANCE=evaflow

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_WEBHOOK_SEND_MESSAGE=$VITE_WEBHOOK_SEND_MESSAGE
ENV VITE_WEBHOOK_BULK_SEND=$VITE_WEBHOOK_BULK_SEND
ENV VITE_EVOLUTION_INSTANCE=$VITE_EVOLUTION_INSTANCE

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Estágio 2: Servidor Web Leve (Nginx)
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
