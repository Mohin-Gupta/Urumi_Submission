# The official MCP reference server, used as a third-party upstream
FROM node:24-alpine
RUN npm install -g @modelcontextprotocol/server-everything@2.0.1
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["mcp-server-everything", "streamableHttp"]
