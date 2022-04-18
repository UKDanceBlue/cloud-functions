import { getFirestore } from "firebase-admin/firestore";
import * as functions from "firebase-functions";

// A list of keys to filter directory entires by (not actually used in the query, but used to determine if a match is found). Ordered by specificity.
const possibleQueryKeys = [
  "lastAssociatedUid",
  "upn",
  "email",
  "firstName",
  "lastName",
  "spiritTeamId",
  "committee",
  "committeeRank",
  "dbRole",
];

/**
 * Looks for a user in the firestore directory using whatever information is available and returns a single match or null, unless returnAll is true, in which case it returns an array of all matches.
 *
 * @param {{lastAssociatedUid: string, upn: string, email:string, firstName: string, lastName: string, spiritTeamId: string, committee: string, committeeRank: ("advisor" | "overall-chair" | "chair" | "coordinator" | "committee-member"), dbRole: ("public" | "team-member" | "committee")}} queryData - An object with any data known about the person being looked up to refine the search.
 * @param {boolean} [returnAll=false] If true, returns an array of all matches instead of just the first.
 * @return {Promise<Object<string, string> | (Object<string, string>)[] | null>} - A promise that resolves to the first match or an array of all matches, or null if no match was found.
 */
export default async function directoryLookup(queryData, returnAll = false) {
  functions.logger.log("Attempting a firestore directory lookup", queryData);

  const firebaseFirestore = getFirestore();

  const { lastAssociatedUid, upn, email, firstName, lastName } = queryData;
  let foundDocuments = null;

  let lookup = { empty: true };
  if (lastAssociatedUid) {
    lookup = await firebaseFirestore
      .collection("directory")
      .where("lastAssociatedUid", "==", lastAssociatedUid)
      .get();
  }
  if (lookup.empty) {
    if (upn) {
      lookup = await firebaseFirestore.collection("directory").where("upn", "==", upn).get();
    }
    if (lookup.empty) {
      if (email) {
        lookup = await firebaseFirestore.collection("directory").where("email", "==", email).get();
      }
      if (lookup.empty) {
        if (lastName) {
          lookup = await firebaseFirestore
            .collection("directory")
            .where("lastName", "==", lastName)
            .get();
        }
        if (lookup.empty) {
          if (firstName) {
            lookup = await firebaseFirestore
              .collection("directory")
              .where("firstName", "==", firstName)
              .get();
          }
          if (lookup.empty) {
            functions.logger.log("No documents found in the directory.");
            return null;
          } else {
            foundDocuments = lookup.docs;
          }
        } else {
          foundDocuments = lookup.docs;
        }
      } else {
        foundDocuments = lookup.docs;
      }
    } else {
      foundDocuments = lookup.docs;
    }
  } else {
    foundDocuments = lookup.docs;
  }

  functions.logger.log(
    `Found ${foundDocuments.length} documents in the directory.`,
    foundDocuments
  );

  let i = 0;
  while (foundDocuments.length > 1 && i < possibleQueryKeys.length) {
    foundDocuments = foundDocuments.filter(
      (doc) => doc.get(possibleQueryKeys[i]) === queryData[possibleQueryKeys[i]]
    );
    i++;
  }
  if (foundDocuments.length > 0) {
    if (foundDocuments.length === 1) {
      functions.logger.log(
        "Successfully found a single directory entry.",
        foundDocuments[0].data()
      );
      return { directoryDocumentId: foundDocuments[0].id, ...foundDocuments[0].data() };
    } else if (returnAll) {
      functions.logger.log("Successfully found multiple directory entries, returning all.");
      return foundDocuments.map((doc) => ({
        directoryDocumentId: doc.id,
        ...doc[0].data(),
      }));
    } else {
      functions.logger.log("Failed to narrow query to a single directory entry.");
      return null;
    }
  } else {
    functions.logger.log("No documents found in the directory.");
    return null;
  }
}
