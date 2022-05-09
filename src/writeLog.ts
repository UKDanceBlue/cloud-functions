import * as functions from "firebase-functions";
import { LogSeverity } from "firebase-functions/logger";

type WriteLogArgument = {
  message: string;
  severity: LogSeverity;
};

function isWriteLogArgument(arg: WriteLogArgument): arg is WriteLogArgument {
  return (
    typeof arg === "object" &&
    arg !== null &&
    typeof arg.message === "string" &&
    typeof arg.severity === "string"
  );
}

export default functions.https.onRequest((req, res) => {
  const requestBody = req.body as WriteLogArgument | string;
  if (typeof requestBody !== "string" && !isWriteLogArgument(requestBody)) {
    res.status(400).send("Invalid request");
    return;
  }

  try {
    if (req.method === "POST") {
      if (typeof requestBody === "string") {
        functions.logger.info(requestBody.toString());
        res.sendStatus(200).end();
        return;
      } else {
        functions.logger.write({
          message: requestBody.message,
          severity: requestBody.severity ? requestBody.severity : "INFO",
        });
        res.sendStatus(200).end();
        return;
      }
    } else if (req.method === "GET") {
      res.sendStatus(403).end();
      return;
    } else {
      res.sendStatus(405).end();
      return;
    }
  } catch (error) {
    res.status(500).send(error).end();
  }
});
