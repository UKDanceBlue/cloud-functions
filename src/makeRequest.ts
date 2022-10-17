import { https } from "firebase-functions/v1";
import fetch, { RequestInfo, RequestInit } from "node-fetch";

export default https.onCall(async (data: {
  url: RequestInfo,
  options?: RequestInit
}, context) => {
  if (context.auth == null) {
    throw new https.HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  return fetch(data.url, data.options);
});
