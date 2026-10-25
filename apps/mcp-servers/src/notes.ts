import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, serve } from "./serve.js";

// In memory on purpose: this is a small second upstream for the demo, not a datastore
const notes: { id: number; subject: string; text: string; created: string }[] = [];

function createServer() {
  const server = new McpServer({ name: "notes", version: "0.1.0" });

  server.registerTool(
    "add_note",
    {
      description: "Save a team note about a customer, an order or anything else.",
      inputSchema: {
        subject: z.string().min(1).describe('What the note is about, e.g. "order 13" or a customer email'),
        text: z.string().min(1),
      },
    },
    async ({ subject, text }) => {
      const note = { id: notes.length + 1, subject, text, created: new Date().toISOString() };
      notes.push(note);
      return jsonResult(note);
    },
  );

  server.registerTool(
    "list_notes",
    {
      description: "List saved notes, optionally only those whose subject contains the given text.",
      inputSchema: { subject: z.string().optional() },
    },
    async ({ subject }) =>
      jsonResult(subject ? notes.filter((n) => n.subject.toLowerCase().includes(subject.toLowerCase())) : notes),
  );

  server.registerTool(
    "echo",
    {
      description: "Echo a message back. Useful to check the notes server is reachable.",
      inputSchema: { message: z.string() },
    },
    async ({ message }) => jsonResult({ server: "notes", message }),
  );

  return server;
}

serve(createServer);
