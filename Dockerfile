FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
ENV PORT=8080
CMD [ "node", "--no-warnings", "--loader", "./node_modules/@google-cloud/functions-framework/build/src/loader.js", "--es-module-specifier-resolution=node", "index.js" ]
