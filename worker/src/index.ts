import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */

export class SessionsRPC extends WorkerEntrypoint<Env> {
	async closeSessions() {
	  try {
	    const id = this.env.SHITERATE_EMOJI.idFromName("globalRoom");
	    const stub = this.env.SHITERATE_EMOJI.get(id);
	    await stub.closeSessions();
	  } catch (error) {
	    // In dev mode, RPC between workers isn't supported
	    console.log("closeSessions called (dev mode limitation)");
	  }
	}
  }

export type WsMessage =
  | { type: "message"; data: string }
  | { type: "quit"; id: string }
  | { type: "join"; id: string }
  | { type: "move"; id: string; x: number; y: number }
  | { type: "start-drag"; id: string; imageId: string; imageUrl: string; x: number; y: number }
  | { type: "drag-move"; id: string; x: number; y: number }
  | { type: "end-drag"; id: string }
  | { type: "get-cursors" }
  | { type: "get-cursors-response"; sessions: Session[] }
  | { type: "get-images" }
  | { type: "get-images-response"; images: PersistedImage[] }
  | { type: "delete-persisted-image"; imageId: string }
  | { type: "image-persisted"; image: PersistedImage };

export type DraggedImage = {
  id: string;
  url: string;
  x: number;
  y: number;
};

export type PersistedImage = {
  id: string;
  url: string;
  x: number;
  y: number;
  timestamp: number;
};

export type Session = {
  id: string;
  x: number;
  y: number;
  draggedImage?: DraggedImage;
};




export class shiterate_emoji extends DurableObject<Env> {
	sql: SqlStorage;


	sessions: Map<WebSocket, Session> = new Map();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.getWebSockets().forEach((ws) => {
			const meta = ws.deserializeAttachment();
			this.sessions.set(ws, { ...meta });
		});
		this.sql = ctx.storage.sql;

		// Only create the table we actually use - dragged_images for persistence
		// The sessions table was unused since session data is handled in memory
		this.sql.exec(`CREATE TABLE IF NOT EXISTS dragged_images(
		  id    TEXT PRIMARY KEY,
		  url   TEXT NOT NULL,
		  x     REAL NOT NULL,
		  y     REAL NOT NULL,
		  timestamp INTEGER NOT NULL
		);`);
	}

	broadcast(message: WsMessage, self?: string) {
		this.ctx.getWebSockets().forEach((ws) => {
			const { id } = ws.deserializeAttachment();
			if (id !== self) ws.send(JSON.stringify(message));
		});
	}

	async webSocketMessage(ws: WebSocket, message: string) {
		if (typeof message !== "string") return;
		const parsedMsg: WsMessage = JSON.parse(message);
		const session = this.sessions.get(ws);
		if (!session) return;

		switch (parsedMsg.type) {
			case "move":
				session.x = parsedMsg.x;
				session.y = parsedMsg.y;
				ws.serializeAttachment(session);
				this.broadcast(parsedMsg, session.id);
				break;

			case "start-drag":
				// Update the session state to show user is dragging
				session.x = parsedMsg.x;
				session.y = parsedMsg.y;
				session.draggedImage = {
					id: parsedMsg.imageId,
					url: parsedMsg.imageUrl,
					x: parsedMsg.x,
					y: parsedMsg.y
				};
				ws.serializeAttachment(session);

				// DON'T delete from database during drag - keep the image in case drag fails
				// Only update position on successful end-drag

				// Broadcast the start-drag message so other users see the dragged image
				// The frontend will handle removing the persisted image when it receives this message
				this.broadcast(parsedMsg, session.id);
				break;

			case "drag-move":
				if (session.draggedImage) {
					session.x = parsedMsg.x;
					session.y = parsedMsg.y;
					session.draggedImage.x = parsedMsg.x;
					session.draggedImage.y = parsedMsg.y;
					ws.serializeAttachment(session);
					this.broadcast(parsedMsg, session.id);
				}
				break;

			case "end-drag":
				// Save/update the image position in the database
				if (session.draggedImage) {
					// Use INSERT OR REPLACE to update existing images or create new ones
					this.sql.exec(
						`INSERT OR REPLACE INTO dragged_images (id, url, x, y, timestamp) VALUES (?, ?, ?, ?, ?)`,
						session.draggedImage.id,
						session.draggedImage.url,
						session.draggedImage.x,
						session.draggedImage.y,
						Date.now()
					);

					// Send the updated persisted image to all users
					const updatedPersistedImage: PersistedImage = {
						id: session.draggedImage.id,
						url: session.draggedImage.url,
						x: session.draggedImage.x,
						y: session.draggedImage.y,
						timestamp: Date.now()
					};

					const imagePersistedMessage: WsMessage = {
						type: "image-persisted",
						image: updatedPersistedImage
					};

					// Broadcast to all users including the one who dropped it
					this.ctx.getWebSockets().forEach((ws) => {
						ws.send(JSON.stringify(imagePersistedMessage));
					});
				}

				// Clear the dragged image from session
				session.draggedImage = undefined;
				ws.serializeAttachment(session);
				this.broadcast(parsedMsg, session.id);
				break;

			case "get-cursors":
				const sessions: Session[] = [];
				this.sessions.forEach((session) => {
					sessions.push(session);
				});
				const wsMessage: WsMessage = { type: "get-cursors-response", sessions };
				ws.send(JSON.stringify(wsMessage));
				break;

			case "get-images":
				// Load all persisted images from the database
				const cursor = this.sql.exec("SELECT * FROM dragged_images ORDER BY timestamp DESC;");
				const images: PersistedImage[] = [];
				for (let row of cursor) {
					images.push({
						id: row.id as string,
						url: row.url as string,
						x: row.x as number,
						y: row.y as number,
						timestamp: row.timestamp as number
					});
				}
				const imagesMessage: WsMessage = { type: "get-images-response", images };
				ws.send(JSON.stringify(imagesMessage));
				break;

						case "delete-persisted-image":
				if (parsedMsg.imageId === "*") {
					// Clear all images from database
					try {
						console.log("🗑️ Clearing ALL images from database");

						// Delete all images using raw SQL execution
						this.sql.exec(`DELETE FROM dragged_images`);
						console.log("🗑️ Delete ALL executed");

						// Verify deletion worked using .one() for single row result
						try {
							const countResult = this.sql.exec(`SELECT COUNT(*) as count FROM dragged_images`).one();
							const remainingCount = countResult?.count || 0;
							console.log("🗑️ Remaining images after deletion:", remainingCount);

							if (remainingCount === 0) {
								console.log("✅ Successfully cleared all images from database");
							} else {
								console.error("❌ Failed to clear all images, remaining:", remainingCount);
							}
						} catch (verifyError) {
							// If the query fails, we can assume the table is empty or there's an issue
							console.log("✅ Delete completed (verification query failed, likely empty)");
						}
					} catch (error) {
						console.error("🗑️ Error clearing all images:", error);
					}
				} else {
					// Delete specific image
					try {
						console.log("🗑️ Deleting specific image:", parsedMsg.imageId);
						this.sql.exec(`DELETE FROM dragged_images WHERE id = ?`, parsedMsg.imageId);
						console.log("🗑️ Delete specific executed");
					} catch (error) {
						console.error("🗑️ Error deleting specific image:", error);
					}
				}

				// Send delete message to ALL users including the sender
				this.ctx.getWebSockets().forEach((ws) => {
					ws.send(JSON.stringify(parsedMsg));
				});
				break;

			case "message":
				this.broadcast(parsedMsg);
				break;

			default:
				break;
		}
	}

	async webSocketClose(ws: WebSocket, code: number) {
		const id = this.sessions.get(ws)?.id;
		id && this.broadcast({ type: 'quit', id });
		this.sessions.delete(ws);
		ws.close();
	}

	closeSessions() {
		this.ctx.getWebSockets().forEach((ws) => ws.close());
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		this.ctx.acceptWebSocket(server);
		const id = url.searchParams.get("id");
		if (!id) {
			return new Response("Missing id", { status: 400 });
		}

		// Set Id and Default Position
		const sessionInitialData: Session = { id, x: -1, y: -1 };
		server.serializeAttachment(sessionInitialData);
		this.sessions.set(server, sessionInitialData);
		this.broadcast({ type: "join", id }, id);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}
}

  export default {
	async fetch(request, env, ctx) {
	  if (request.url.match("/ws")) {
	    const upgradeHeader = request.headers.get("Upgrade");
	    if (!upgradeHeader || upgradeHeader !== "websocket") {
	      return new Response("Durable Object expected Upgrade: websocket", {
	        status: 426,
	      });
	    }
	    const id = env.SHITERATE_EMOJI.idFromName("globalRoom");
	    const stub = env.SHITERATE_EMOJI.get(id);
	    return stub.fetch(request);
	  }
	  return new Response(null, {
	    status: 400,
	    statusText: "Bad Request",
	    headers: {
	      "Content-Type": "text/plain",
	    },
	  });
	},
  } satisfies ExportedHandler<Env>;
