import * as functions from "firebase-functions";

export default async (req, res) => {
  try {
    if (req.method === "POST") {
      if (req.body && typeof req.body === "string") {
        functions.logger.info(req.body.toString());
        res.sendStatus(200).end();
        return;
      } else if (
        req.body &&
        typeof req.body === "object" &&
        !Array.isArray(req.body) &&
        typeof req.body.message === "string"
      ) {
        functions.logger.write({
          message: req.body.message,
          severity: req.body.severity ? req.body.severity : "INFO",
        });
        res.sendStatus(200).end();
        return;
      } else {
        res.sendStatus(400).end();
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
};
