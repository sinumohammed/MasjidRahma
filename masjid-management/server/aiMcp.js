// The AI read-only API (/api/ai/*, app.js) as an MCP server, at /api/ai/mcp.
// The same data for any MCP client: the AI service's MCP connector, Claude
// Desktop, Claude Code. Nothing new is exposed - each tool is one /api/ai/*
// endpoint:
//   - the tools are made from AI_OPENAPI (aiOpenapi.js): name = operationId,
//     description = summary, arguments = its parameters - one description for
//     both, so they cannot drift apart
//   - a tool call runs the endpoint's own handler, with the same user and
//     role rules; a refusal ("only the admin can see ...") is a tool error
//     with that reason
//   - every tool is marked read-only (readOnlyHint), as every endpoint is GET
// Access is the same as /api/ai/*: MASJID_AI_TOKEN (checked by
// requireAiToken before this runs) and, for a tool call, the 5-minute user
// token in X-User-Token. Listing the tools needs no user, like openapi.json.
//
// Stateless (a new server per request, JSON answers, no sessions), so it
// works in a Vercel function: nothing is kept between requests.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// AI_OPENAPI -> [{ name, path, tool }]: path is the router's ('/today-duty').
function toolsFrom(openapi) {
  return Object.entries(openapi.paths).flatMap(([path, item]) => {
    const op = item.get;
    if (!op) return [];
    const properties = {};
    const required = [];
    for (const p of op.parameters ?? []) {
      const { type = 'string', format, enum: values } = p.schema ?? {};
      properties[p.name] = { type, ...(format ? { format } : {}), ...(values ? { enum: values } : {}), ...(p.description ? { description: p.description } : {}) };
      if (p.required) required.push(p.name);
    }
    return [{
      name: op.operationId,
      path: path.replace(/^\/ai/, ''),
      tool: {
        name: op.operationId,
        description: op.summary,
        inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
    }];
  });
}

const textResult = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });

// handlers: '/today-duty' -> async (req) => data, as registered in app.js.
// userFrom(req): the X-User-Token's user, or throws. guestPaths: what a guest may see.
export function aiMcpHandler({ openapi, handlers, userFrom, guestPaths, guestRefusal, info }) {
  const tools = toolsFrom(openapi).filter((t) => handlers.has(t.path));

  function serverFor(req) {
    const server = new Server(info, { capabilities: { tools: {} }, instructions: openapi.info.description });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((t) => t.tool) }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const t = tools.find((x) => x.name === params.name);
      if (!t) return textResult(`unknown tool: ${params.name}`, true);
      let aiUser;
      try {
        aiUser = userFrom(req);
      } catch (error) {
        return textResult(error.message, true);
      }
      if (aiUser.guest && !guestPaths.has(t.path)) return textResult(guestRefusal, true);
      // The handler reads req.query as Express gives it: strings.
      const query = {};
      for (const [k, v] of Object.entries(params.arguments ?? {})) {
        if (v !== undefined && v !== null && k in t.tool.inputSchema.properties) query[k] = String(v);
      }
      try {
        return textResult(JSON.stringify(await handlers.get(t.path)({ query, aiUser, path: t.path })));
      } catch (error) {
        if (!error.status) console.error(`[ai mcp] ${t.name}:`, error);
        return textResult(error.status ? error.message : 'Server error', true);
      }
    });
    return server;
  }

  return async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => transport.close());
    try {
      await serverFor(req).connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[ai mcp]', error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Server error' }, id: null });
    }
  };
}
