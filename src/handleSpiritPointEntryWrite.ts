import { FieldPath, FieldValue, getFirestore,  } from "firebase-admin/firestore";
import { firestore as functionsFirestore } from "firebase-functions";

import { isSpiritPointEntry } from "./types/FirestoreSpiritPointEntry";

export default functionsFirestore.document("/spirit/teams/{teamId}/{opportunityId}").onWrite(async (change, context) => {
  // Get firestore
  const firestore = getFirestore();
  const batch = firestore.batch();

  const teamId = context.params.teamId as string;
  const opportunityId = context.params.opportunityId as string;

  if (context.eventType === "google.firestore.document.create") {
    const entry = change.after.data();
    if (entry == null) {
      return;
    }

    // Verify the document's structure
    if (!isSpiritPointEntry(entry)) {
      return change.after.ref.delete();
    }

    // Make a copy under the relevant opportunity
    const opportunityEntryDocument = firestore.doc(`/spirit/opportunities/${opportunityId}/${change.after.id}`);
    batch.set(opportunityEntryDocument, entry);

    // Increment /spirit/teams/{teamId}/info.totalPoints and /spirit/teams/{teamId}/info.individualTotals
    const teamInfoDocument = firestore.doc(`/spirit/teams/${teamId}/info`);
    batch.update(teamInfoDocument, {
      totalPoints: FieldValue.increment(entry.points),
    });
    batch.update(teamInfoDocument, {
      [`individualTotals.${entry.linkblue}`]: FieldValue.increment(entry.points),
    });

    // Increment /spirit/teams/info.points.{teamId}
    const rootTeamsDoc = firestore.doc("/spirit/teams");
    batch.update(rootTeamsDoc, new FieldPath("points", teamId), FieldValue.increment(entry.points));

    // Increment /spirit/opportunities/{opportunityId}.totalPoints
    const opportunityInfoDocument = firestore.doc(`/spirit/opportunities/${opportunityId}/info`);
    batch.update(opportunityInfoDocument, {
      totalPoints: FieldValue.increment(entry.points),
    });

    // Increment /spirit/info.totalPoints
    const rootInfoDoc = firestore.doc("/spirit/info");
    batch.update(rootInfoDoc, {
      totalPoints: FieldValue.increment(entry.points),
    });
  } else if(context.eventType === "google.firestore.document.delete") {
    const entry = change.before.data();
    if (entry == null) {
      return;
    }

    // Verify the document's structure
    if (!isSpiritPointEntry(entry)) {
      return;
    }

    // Delete the copy under the relevant opportunity
    const opportunityEntryDocument = firestore.doc(`/spirit/opportunities/${opportunityId}/${change.before.id}`);
    batch.delete(opportunityEntryDocument);

    // Decrement /spirit/teams/{teamId}/info.totalPoints and /spirit/teams/{teamId}/info.individualTotals
    const teamInfoDocument = firestore.doc(`/spirit/teams/${teamId}/info`);
    batch.update(teamInfoDocument, {
      totalPoints: FieldValue.increment(-entry.points),
    });
    batch.update(teamInfoDocument, {
      [`individualTotals.${entry.linkblue}`]: FieldValue.increment(-entry.points),
    });

    // Decrement /spirit/teams/info.points.{teamId}
    const rootTeamsDoc = firestore.doc("/spirit/teams");
    batch.update(rootTeamsDoc, new FieldPath("points", teamId), FieldValue.increment(-entry.points));

    // Decrement /spirit/opportunities/{opportunityId}.totalPoints
    const opportunityInfoDocument = firestore.doc(`/spirit/opportunities/${opportunityId}/info`);
    batch.update(opportunityInfoDocument, {
      totalPoints: FieldValue.increment(-entry.points),
    });

    // Decrement /spirit/info.totalPoints
    const rootInfoDoc = firestore.doc("/spirit/info");
    batch.update(rootInfoDoc, {
      totalPoints: FieldValue.increment(-entry.points),
    });
  }

  await batch.commit();
});
