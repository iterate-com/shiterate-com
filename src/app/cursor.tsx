"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import type {
  Session,
  WsMessage,
  PersistedImage,
} from "../../worker/src/index";
import { PerfectCursor } from "perfect-cursors";

const INTERVAL = 55;

export function Cursors(props: { id: string }) {
  const wsRef = useRef<WebSocket | null>(null);
  const [cursors, setCursors] = useState<Map<string, Session>>(new Map());
  const [persistedImages, setPersistedImages] = useState<PersistedImage[]>([]);
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const [currentDraggedImage, setCurrentDraggedImage] = useState<{
    id: string;
    url: string;
  } | null>(null);
  const lastSentTimestamp = useRef(0);
  const [, dispatchMessage] = useReducer(messageReducer, {
    in: "",
    out: "",
  });
  const [, highlightIn] = useHighlight();
  const [, highlightOut] = useHighlight();

  // Countdown timer state
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  }>({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  function startWebSocket() {
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsHost = process.env.NEXT_PUBLIC_WS_HOST || window.location.host;
    const ws = new WebSocket(`${wsProtocol}://${wsHost}/ws?id=${props.id}`);
    ws.onopen = () => {
      highlightOut();
      dispatchMessage({ type: "out", message: "get-cursors" });
      const message: WsMessage = { type: "get-cursors" };
      ws.send(JSON.stringify(message));

      // Also request persisted images
      const imagesMessage: WsMessage = { type: "get-images" };
      ws.send(JSON.stringify(imagesMessage));
    };
    ws.onmessage = (message) => {
      const messageData: WsMessage = JSON.parse(message.data);
      highlightIn();
      dispatchMessage({ type: "in", message: messageData.type });
      switch (messageData.type) {
        case "quit":
          setCursors((prev) => {
            const updated = new Map(prev);
            updated.delete(messageData.id);
            return updated;
          });
          break;
        case "join":
          setCursors((prev) => {
            const updated = new Map(prev);
            if (!updated.has(messageData.id)) {
              updated.set(messageData.id, { id: messageData.id, x: -1, y: -1 });
            }
            return updated;
          });
          break;
        case "move":
          setCursors((prev) => {
            const updated = new Map(prev);
            const session = updated.get(messageData.id);
            if (session) {
              session.x = messageData.x;
              session.y = messageData.y;
            } else {
              updated.set(messageData.id, messageData);
            }
            return updated;
          });
          break;
        case "get-cursors-response":
          setCursors(
            new Map(
              messageData.sessions.map((session) => [session.id, session])
            )
          );
          break;
        case "get-images-response":
          setPersistedImages(messageData.images);
          break;
        case "image-persisted":
          setPersistedImages((prev) => {
            // Remove any existing image with the same ID and add the new one
            const filtered = prev.filter(
              (img) => img.id !== messageData.image.id
            );
            return [...filtered, messageData.image];
          });

          // Clear the dragged image ID since the image is now persisted at the new position
          setDraggedImageId(null);

          break;
        case "delete-persisted-image":
          console.log(
            "🗑️ Received delete-persisted-image message:",
            messageData.imageId
          );
          console.log(
            "🗑️ Current persisted images:",
            persistedImages.map((img) => img.id)
          );
          setPersistedImages((prev) => {
            const filtered = prev.filter(
              (img) => img.id !== messageData.imageId
            );
            console.log(
              "🗑️ After filtering:",
              filtered.map((img) => img.id)
            );
            return filtered;
          });
          break;
        case "start-drag":
          console.log(
            "📨 Received start-drag message:",
            messageData.id,
            messageData.imageId,
            "current user:",
            props.id
          );

          setCursors((prev) => {
            const updated = new Map(prev);
            let session = updated.get(messageData.id);
            if (!session) {
              // Create session if it doesn't exist
              session = {
                id: messageData.id,
                x: messageData.x,
                y: messageData.y,
              };
              updated.set(messageData.id, session);
            }
            session.x = messageData.x;
            session.y = messageData.y;
            session.draggedImage = {
              id: messageData.imageId,
              url: messageData.imageUrl,
              x: messageData.x,
              y: messageData.y,
            };

            console.log(
              "🎯 Updated cursor for user:",
              messageData.id,
              "with dragged image:",
              session.draggedImage
            );
            return updated;
          });

          // DON'T remove from persistedImages during drag - this destroys the draggable element
          // Instead, keep it hidden via CSS (draggedImageId) and remove it later when the new position arrives

          // Set the draggedImageId for other users too, so they see it as hidden
          if (messageData.id !== props.id) {
            console.log(
              "👀 Setting draggedImageId for other user:",
              messageData.imageId
            );
            setDraggedImageId(messageData.imageId);
          }

          break;
        case "drag-move":
          setCursors((prev) => {
            const updated = new Map(prev);
            const session = updated.get(messageData.id);
            if (session) {
              session.x = messageData.x;
              session.y = messageData.y;
              // Update dragged image position if it exists
              if (session.draggedImage) {
                session.draggedImage.x = messageData.x;
                session.draggedImage.y = messageData.y;
              }
            }
            return updated;
          });
          break;
        case "end-drag":
          console.log(
            "📨 Received end-drag message:",
            messageData.id,
            "current user:",
            props.id
          );

          setCursors((prev) => {
            const updated = new Map(prev);
            const session = updated.get(messageData.id);
            if (session) {
              session.draggedImage = undefined;
            }
            return updated;
          });

          // Clear dragged image ID only if this was our drag or if we were tracking this drag
          // The image-persisted message will also clear it, so this is a backup
          if (messageData.id === props.id) {
            console.log("🧹 Clearing draggedImageId for our drag");
            setDraggedImageId(null);
          }

          break;
        default:
          break;
      }
    };
    ws.onclose = () => setCursors(new Map());
    return ws;
  }

  useEffect(() => {
    const abortController = new AbortController();
    document.addEventListener(
      "mousemove",
      (ev) => {
        const x = ev.pageX / window.innerWidth,
          y = ev.pageY / window.innerHeight;
        const now = Date.now();
        if (
          now - lastSentTimestamp.current > INTERVAL &&
          wsRef.current?.readyState === WebSocket.OPEN
        ) {
          const message: WsMessage = { type: "move", id: props.id, x, y };
          wsRef.current.send(JSON.stringify(message));
          lastSentTimestamp.current = now;
          highlightOut();
          dispatchMessage({ type: "out", message: "move" });
        }
      },
      {
        signal: abortController.signal,
      }
    );
    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    wsRef.current = startWebSocket();
    return () => wsRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);

  // Clean up dragged image state if WebSocket connection is reset
  useEffect(() => {
    // Reset dragged image ID when cursors are cleared (connection lost)
    if (cursors.size === 0 && draggedImageId) {
      setDraggedImageId(null);
    }
  }, [cursors.size, draggedImageId]);

  // Countdown timer effect
  useEffect(() => {
    // Hardcoded target date - August 1st, 2025
    const targetDate = new Date("2025-08-01T00:00:00Z"); // August 1, 2025

    const updateTimer = () => {
      const now = new Date().getTime();
      const target = targetDate.getTime();
      const difference = target - now;

      console.log("Timer debug:", {
        now: new Date(now).toISOString(),
        target: new Date(target).toISOString(),
        difference: difference,
        differenceInDays: Math.floor(difference / (1000 * 60 * 60 * 24)),
      });

      if (difference > 0) {
        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor(
          (difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
        );
        const minutes = Math.floor(
          (difference % (1000 * 60 * 60)) / (1000 * 60)
        );
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);

        setTimeLeft({ days, hours, minutes, seconds });
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      }
    };

    updateTimer(); // Initial update
    const interval = setInterval(updateTimer, 1000); // Update every second

    return () => clearInterval(interval);
  }, []);

  // Prevent default drag behavior to avoid "fly back" effect
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, []);

  function handleDragStart(
    e: React.DragEvent,
    imageId: string,
    imageUrl: string
  ) {
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;

    // Generate a unique ID for each drag operation
    const uniqueImageId = `${imageId}-${props.id}-${Date.now()}`;

    // Store the dragged image info for the trash can
    setCurrentDraggedImage({ id: uniqueImageId, url: imageUrl });

    // Update the current user's session immediately with the dragged image
    setCursors((prev) => {
      const updated = new Map(prev);
      let session = updated.get(props.id);
      if (!session) {
        session = {
          id: props.id,
          x: x,
          y: y,
        };
        updated.set(props.id, session);
      }
      session.x = x;
      session.y = y;
      session.draggedImage = {
        id: uniqueImageId,
        url: imageUrl,
        x: x,
        y: y,
      };
      return updated;
    });

    const message: WsMessage = {
      type: "start-drag",
      id: props.id,
      imageId: uniqueImageId,
      imageUrl,
      x,
      y,
    };
    wsRef.current?.send(JSON.stringify(message));
    highlightOut();
    dispatchMessage({ type: "out", message: "start-drag" });
  }

  function handleDrag(e: React.DragEvent) {
    if (e.clientX === 0 && e.clientY === 0) return; // Ignore invalid drag events

    console.log("🔄 Drag move:", e.clientX, e.clientY);

    // Prevent default behavior to avoid "fly back" effect
    e.preventDefault();

    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;

    const message: WsMessage = {
      type: "drag-move",
      id: props.id,
      x,
      y,
    };
    wsRef.current?.send(JSON.stringify(message));
    highlightOut();
    dispatchMessage({ type: "out", message: "drag-move" });
  }

  function handleDragEnd() {
    console.log("🛑 Drag end called");

    // Clear the dragged image ID when drag ends
    setDraggedImageId(null);

    // Clear the current user's dragged image immediately
    setCursors((prev) => {
      const updated = new Map(prev);
      const session = updated.get(props.id);
      if (session) {
        session.draggedImage = undefined;
      }
      return updated;
    });

    const message: WsMessage = {
      type: "end-drag",
      id: props.id,
    };
    wsRef.current?.send(JSON.stringify(message));
    highlightOut();
    dispatchMessage({ type: "out", message: "end-drag" });

    // Clear the current dragged image info after a brief delay
    // This ensures the trash can has time to access it in onDrop
    setTimeout(() => {
      setCurrentDraggedImage(null);
    }, 100);
  }

  function handlePersistedImageDragStart(
    e: React.DragEvent,
    imageId: string,
    imageUrl: string,
    startX: number,
    startY: number
  ) {
    console.log("🚀 Drag start for persisted image:", imageId);

    // Store the dragged image info for the trash can
    setCurrentDraggedImage({ id: imageId, url: imageUrl });

    // Defer the state change until after the drag start event completes
    // This prevents the browser from canceling the drag operation
    setTimeout(() => {
      console.log("🫥 Setting draggedImageId after timeout:", imageId);
      setDraggedImageId(imageId);
    }, 0);

    // Update the current user's session immediately with the dragged image
    setCursors((prev) => {
      const updated = new Map(prev);
      let session = updated.get(props.id);
      if (!session) {
        session = {
          id: props.id,
          x: startX,
          y: startY,
        };
        updated.set(props.id, session);
      }
      session.x = startX;
      session.y = startY;
      session.draggedImage = {
        id: imageId,
        url: imageUrl,
        x: startX,
        y: startY,
      };
      return updated;
    });

    // Send start-drag message to server
    const message: WsMessage = {
      type: "start-drag",
      id: props.id,
      imageId,
      imageUrl,
      x: startX,
      y: startY,
    };
    wsRef.current?.send(JSON.stringify(message));
    highlightOut();
    dispatchMessage({ type: "out", message: "start-drag" });
  }

  const otherCursors = Array.from(cursors.values()).filter(
    ({ id, x, y }) => id !== props.id && x !== -1 && y !== -1
  );

  // Get current user's cursor to show their dragged image
  const currentUserCursor = cursors.get(props.id);

  return (
    <>
      {/* Central heading */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-800 mb-2">
          iterate-com/shiterate
        </h1>
        <p className="text-gray-600">Something is brewing</p>
      </div>

      {/* Centered drag boxes */}
      <div className="flex gap-6 justify-center">
        <div className="p-6 bg-white border-2 border-gray-200 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:border-blue-300">
          <div
            className="w-32 h-32 cursor-move flex items-center justify-center select-none hover:scale-110 transition-all duration-300 rounded-lg bg-gray-50 hover:bg-gray-100"
            draggable
            onDragStart={(e) =>
              handleDragStart(e, "shiterate", "/shiterate.png")
            }
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
          >
            <Image
              src="/shiterate.png"
              alt="Shiterate"
              width={96}
              height={96}
              className="w-24 h-24 object-contain drop-shadow-md"
              draggable={false}
            />
          </div>
        </div>
        <div className="p-6 bg-white border-2 border-gray-200 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:border-blue-300">
          <div
            className="w-32 h-32 cursor-move flex items-center justify-center select-none hover:scale-110 transition-all duration-300 rounded-lg bg-gray-50 hover:bg-gray-100"
            draggable
            onDragStart={(e) =>
              handleDragStart(e, "nustom_logo", "/nustom_logo.jpg")
            }
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
          >
            <Image
              src="/nustom_logo.jpg"
              alt="Nustom Logo"
              width={96}
              height={96}
              className="w-24 h-24 object-contain drop-shadow-md"
              draggable={false}
            />
          </div>
        </div>
      </div>

      {/* Countdown Timer */}
      <div className="text-center mt-8">
        <h2 className="text-xl font-semibold text-gray-700 mb-3">
          Time Remaining
        </h2>
        <div className="flex gap-4 justify-center">
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-800">
              {timeLeft.days}
            </div>
            <div className="text-sm text-gray-600">Days</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-800">
              {timeLeft.hours}
            </div>
            <div className="text-sm text-gray-600">Hours</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-800">
              {timeLeft.minutes}
            </div>
            <div className="text-sm text-gray-600">Minutes</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-800">
              {timeLeft.seconds}
            </div>
            <div className="text-sm text-gray-600">Seconds</div>
          </div>
        </div>
      </div>

      {/* Social Media Buttons */}
      <div className="text-center mt-15">
        <div className="flex gap-4 justify-center">
          <a
            href="https://www.linkedin.com/company/iterate-com"
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 bg-white border-2 border-gray-200 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:border-blue-300 hover:scale-110"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="#6b7280"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          </a>
          <a
            href="https://x.com/iterate"
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 bg-white border-2 border-gray-200 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:border-blue-300 hover:scale-110"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="#6b7280"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>
      </div>

      {/* Render current user's dragged image */}
      {currentUserCursor?.draggedImage && (
        <div
          className="absolute w-24 h-24 pointer-events-none opacity-75 flex items-center justify-center"
          style={{
            left: currentUserCursor.draggedImage.x * window.innerWidth,
            top: currentUserCursor.draggedImage.y * window.innerHeight,
            transform: "translate(-50%, -50%)",
          }}
        >
          <Image
            src={currentUserCursor.draggedImage.url}
            alt="Dragged Image"
            width={80}
            height={80}
            className="w-20 h-20 object-contain"
          />
        </div>
      )}

      <div>
        {otherCursors.map((session) => (
          <div key={session.id}>
            <SvgCursor
              point={[
                session.x * window.innerWidth,
                session.y * window.innerHeight,
              ]}
            />
            {session.draggedImage && (
              <div
                className="absolute w-24 h-24 pointer-events-none opacity-75 flex items-center justify-center"
                style={{
                  left: session.draggedImage.x * window.innerWidth,
                  top: session.draggedImage.y * window.innerHeight,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <Image
                  src={session.draggedImage.url}
                  alt="Dragged Image"
                  width={80}
                  height={80}
                  className="w-20 h-20 object-contain"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Render persisted images */}
      <div>
        {persistedImages.map((image) => (
          <div
            key={image.id}
            className={`absolute w-24 h-24 cursor-move flex items-center justify-center opacity-90 hover:scale-110 transition-transform select-none ${
              draggedImageId === image.id ? "opacity-0 pointer-events-none" : ""
            }`}
            style={{
              left: image.x * window.innerWidth,
              top: image.y * window.innerHeight,
              transform: "translate(-50%, -50%)",
            }}
            draggable
            onDragStart={(e) =>
              handlePersistedImageDragStart(
                e,
                image.id,
                image.url,
                image.x,
                image.y
              )
            }
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
          >
            <Image
              src={image.url}
              alt="Persisted Image"
              width={80}
              height={80}
              className="w-20 h-20 object-contain"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {/* Trash can in bottom right corner */}
      <div
        className="fixed bottom-4 right-4 w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center cursor-pointer transition-colors shadow-lg"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();

          console.log("🗑️ Item dropped on trash can");
          console.log("🔍 Current dragged image:", currentDraggedImage);

          if (currentDraggedImage) {
            const imageId = currentDraggedImage.id;
            console.log("🗑️ Deleting image with ID:", imageId);

            // Send delete message to server
            const message: WsMessage = {
              type: "delete-persisted-image",
              imageId: imageId,
            };
            console.log("📤 Sending delete message to server:", message);
            wsRef.current?.send(JSON.stringify(message));
            highlightOut();
            dispatchMessage({ type: "out", message: "delete-persisted-image" });

            // Clear the dragged image state immediately
            setDraggedImageId(null);
            setCurrentDraggedImage(null);

            // Clear the cursor's dragged image
            setCursors((prev) => {
              const updated = new Map(prev);
              const session = updated.get(props.id);
              if (session) {
                session.draggedImage = undefined;
              }
              return updated;
            });
          } else {
            console.log("❌ No current dragged image found");
          }
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c0 1 1 2 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </div>
    </>
  );
}

function SvgCursor({ point }: { point: number[] }) {
  const refSvg = useRef<SVGSVGElement>(null);
  const animateCursor = useCallback((point: number[]) => {
    refSvg.current?.style.setProperty(
      "transform",
      `translate(${point[0]}px, ${point[1]}px)`
    );
  }, []);
  const onPointMove = usePerfectCursor(animateCursor);
  useLayoutEffect(() => onPointMove(point), [onPointMove, point]);
  const [randomColor] = useState(
    `#${Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, "0")}`
  );
  return (
    <svg
      ref={refSvg}
      height="32"
      width="32"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={"absolute -top-[12px] -left-[12px] pointer-events-none"}
    >
      <defs>
        <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="1" dy="1" stdDeviation="1.2" floodOpacity="0.5" />
        </filter>
      </defs>
      <g fill="none" transform="rotate(0 16 16)" filter="url(#shadow)">
        <path
          d="M12 24.4219V8.4069L23.591 20.0259H16.81l-.411.124z"
          fill="white"
        />
        <path
          d="M21.0845 25.0962L17.4795 26.6312L12.7975 15.5422L16.4835 13.9892z"
          fill="white"
        />
        <path
          d="M19.751 24.4155L17.907 25.1895L14.807 17.8155L16.648 17.04z"
          fill={randomColor}
        />
        <path
          d="M13 10.814V22.002L15.969 19.136l.428-.139h4.768z"
          fill={randomColor}
        />
      </g>
    </svg>
  );
}

function usePerfectCursor(cb: (point: number[]) => void, point?: number[]) {
  const [pc] = useState(() => new PerfectCursor(cb));

  useLayoutEffect(() => {
    if (point) pc.addPoint(point);
    return () => pc.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pc]);

  useLayoutEffect(() => {
    PerfectCursor.MAX_INTERVAL = 58;
  }, []);

  const onPointChange = useCallback(
    (point: number[]) => pc.addPoint(point),
    [pc]
  );

  return onPointChange;
}

type MessageState = { in: string; out: string };
type MessageAction = { type: "in" | "out"; message: string };
function messageReducer(state: MessageState, action: MessageAction) {
  switch (action.type) {
    case "in":
      return { ...state, in: action.message };
    case "out":
      return { ...state, out: action.message };
    default:
      return state;
  }
}

function useHighlight(duration = 250) {
  const timestampRef = useRef(0);
  const [highlighted, setHighlighted] = useState(false);
  function highlight() {
    timestampRef.current = Date.now();
    setHighlighted(true);
    setTimeout(() => {
      const now = Date.now();
      if (now - timestampRef.current >= duration) {
        setHighlighted(false);
      }
    }, duration);
  }
  return [highlighted, highlight] as const;
}
