import { getAuth } from "firebase-admin/auth";

export default async (req, res) => {
  const response = { status: undefined, usersDeleted: [], errors: [] };

  const annonCutoffDate = new Date();
  annonCutoffDate.setDate(annonCutoffDate.getDate() - 3);

  const linkBlueCutoffDate = new Date();
  linkBlueCutoffDate.setDate(linkBlueCutoffDate.getDate() - 370);

  const listAllUsers = async (nextPageToken) => {
    // List batch of users, 1000 at a time.
    await getAuth()
      .listUsers(1000, nextPageToken)
      .then((listUsersResult) => {
        listUsersResult.users.forEach((userRecord) => {
          if (userRecord.providerData.length === 0) {
            if (new Date(userRecord.metadata.lastRefreshTime) < annonCutoffDate) {
              response.usersDeleted = response.usersDeleted.push(userRecord.uid);
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
          listAllUsers(listUsersResult.pageToken);
        }
      })
      .catch((error) => {
        response.status = "ERROR";
        response.errors.push(error);
        return;
      });
  };
  // Start recusively listing users from the beginning, 1000 at a time.
  await listAllUsers();

  if (!(response.status === "ERROR")) {
    response.status = "OK";
  }
  res.json(response);
};
