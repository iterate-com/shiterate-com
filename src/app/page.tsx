import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Cursors } from "@/app/cursor";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";

async function closeSessions() {
  "use server";
  const cf = await getCloudflareContext();

  // Use the Durable Object directly
  const id = cf.env.SHITERATE_EMOJI.idFromName("globalRoom");
  const stub = cf.env.SHITERATE_EMOJI.get(id);
  await stub.closeSessions();
}

export default function Home() {
  const id = `ws_${nanoid(50)}`;
  return (
    <main className="flex min-h-screen flex-col items-center p-24 justify-center">
      <div className="px-2 space-y-2">
        <Cursors id={id}></Cursors>
      </div>
    </main>
  );
}
