import * as functions from "firebase-functions";
import { getAuth } from "firebase-admin/auth";

// TODO: update for new design

export default functions.https.onRequest(async (req, res) => {
  const response: { status?: string; usersDeleted: string[]; errors: Error[] } = {
    usersDeleted: [],
    errors: [],
  };

  const annonCutoffDate = new Date();
  annonCutoffDate.setDate(annonCutoffDate.getDate() - 3);

  const linkBlueCutoffDate = new Date();
  linkBlueCutoffDate.setDate(linkBlueCutoffDate.getDate() - 370);

  const listAllUsers = async (nextPageToken: string | undefined) => {
    // List batch of users, 1000 at a time.
    const listUsersResult = await getAuth().listUsers(1000, nextPageToken);
    listUsersResult.users.forEach((userRecord) => {
      if (userRecord.providerData.length === 0) {
        if (
          userRecord.metadata.lastRefreshTime &&
          new Date(userRecord.metadata.lastRefreshTime) < annonCutoffDate
        ) {
          response.usersDeleted.push(userRecord.uid);
        }
      } else if (userRecord.providerData[0].providerId === "saml.jumpcloud-demo") {
        /* Linkblue ID: saml.danceblue-firebase-linkblue-saml */
        console.log(userRecord.uid + " is linkblue");
      } else if (userRecord.providerData[0].providerId === "google.com") {
        console.log(userRecord.uid + " is google");
      }
    });
    if (listUsersResult.pageToken) {
      // List next batch of users.
      await listAllUsers(listUsersResult.pageToken);
    }
  };
  // Start recursively listing users from the beginning, 1000 at a time.
  await listAllUsers(undefined);

  if (!(response.status === "ERROR")) {
    response.status = "OK";
  }
  res.json(response);
});
