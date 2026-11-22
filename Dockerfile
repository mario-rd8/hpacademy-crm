# Estágio 1: Build do Frontend (BD-Perfect - variáveis VITE_* congeladas no build time)
FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_WEBHOOK_SEND_MESSAGE=/api/messages/send
ARG VITE_WEBHOOK_BULK_SEND=/api/messages/bulk
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

# Estágio 2: Servidor Node.js leve (serve dist/ + API segura Evolution API, sem n8n)
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "server.js"]
