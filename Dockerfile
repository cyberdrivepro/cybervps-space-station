FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8080
ENV PORT=8080
ENV CYBERVPS_HOST=0.0.0.0
CMD ["node", "services/server.js"]
