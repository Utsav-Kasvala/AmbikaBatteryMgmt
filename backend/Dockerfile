FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm install

# Source (overridden at runtime by volume mount in dev)
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
