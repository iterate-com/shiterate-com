import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Cursors } from "@/app/cursor";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";

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
