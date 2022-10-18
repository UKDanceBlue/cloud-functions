import { https } from "firebase-functions/v1";
import fetch, { RequestInfo, RequestInit } from "node-fetch";

export default https.onCall(async (data: {
  url: RequestInfo,
  options?: RequestInit
}, context) => {
  if (context.auth == null) {
    throw new https.HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  try {
    const res = await fetch(data.url, data.options);
    return await res.json();
  } catch (err) {
    throw new https.HttpsError("internal", String((err as Error).message), err);
  }
});
