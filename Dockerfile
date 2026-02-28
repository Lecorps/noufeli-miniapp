FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
CMD ["npx", "@google-cloud/functions-framework", "--target=noufeliBot", "--signature-type=http"]
