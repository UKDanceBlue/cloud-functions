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

    // Make a copy to /spirit/opportunities/documents/{opportunityId}/pointEntries/{entryId}
    const opportunityEntryDocument = firestore.doc(`/spirit/opportunities/documents/${opportunityId}/pointEntries/${change.after.id}`);
    batch.set(opportunityEntryDocument, entry);

    // Increment /spirit/teams/documents/{teamId}.totalPoints and /spirit/teams/documents/{teamId}.individualTotals
    const teamInfoDocument = firestore.doc(`/spirit/teams/documents/${teamId}/info`);
    batch.update(teamInfoDocument, {
      totalPoints: FieldValue.increment(entry.points),
    });
    batch.update(teamInfoDocument, {
      [`individualTotals.${entry.linkblue}`]: FieldValue.increment(entry.points),
    });

    // Increment /spirit/teams.points.{teamId}
    const rootTeamsDoc = firestore.doc("/spirit/teams");
    batch.update(rootTeamsDoc, new FieldPath("points", teamId), FieldValue.increment(entry.points));

    // Increment /spirit/opportunities/documents/{opportunityId}.totalPoints
    const opportunityInfoDocument = firestore.doc(`/spirit/opportunities/documents/${opportunityId}`);
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

    // Delete /spirit/opportunities/documents/{opportunityId}/pointEntries/{entryId}
    const opportunityEntryDocument = firestore.doc(`/spirit/opportunities/documents/${opportunityId}/pointEntries/${change.before.id}`);
    batch.delete(opportunityEntryDocument);

    // Decrement /spirit/teams/documents/{teamId}.totalPoints and /spirit/teams/documents/{teamId}.individualTotals
    const teamInfoDocument = firestore.doc(`/spirit/teams/documents/${teamId}/info`);
    batch.update(teamInfoDocument, {
      totalPoints: FieldValue.increment(-entry.points),
    });
    batch.update(teamInfoDocument, {
      [`individualTotals.${entry.linkblue}`]: FieldValue.increment(-entry.points),
    });

    // Decrement /spirit/teams.points.{teamId}
    const rootTeamsDoc = firestore.doc("/spirit/teams");
    batch.update(rootTeamsDoc, new FieldPath("points", teamId), FieldValue.increment(-entry.points));

    // Decrement /spirit/opportunities/documents/{opportunityId}.totalPoints
    const opportunityInfoDocument = firestore.doc(`/spirit/opportunities/documents/${opportunityId}`);
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
