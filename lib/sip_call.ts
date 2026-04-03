"use server";

import { SipClient, RoomServiceClient } from "livekit-server-sdk";

export async function createSipCall(
  roomName: string,
  phoneNumber: string,
  sipTrunkId?: string
) {
  const trunkId = sipTrunkId || process.env.SIP_TRUNK_ID;
  if (!trunkId) {
    throw new Error("SIP Trunk ID is required");
  }
  if (!phoneNumber) {
    throw new Error("Phone number is required");
  }

  const sipClient = new SipClient(
    process.env.LIVEKIT_URL || "",
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET
  );

  const participant = await sipClient.createSipParticipant(
    trunkId,
    phoneNumber,
    roomName,
    {
      playDialtone: true,
      hidePhoneNumber: false,
      ringingTimeout: 60,
      waitUntilAnswered: true,
    }
  );

  console.log("SIP call created", participant);

  return {
    participantIdentity: participant.participantIdentity,
    participantId: participant.participantId,
  };
}

export async function hangupSipCall(
  roomName: string,
  participantIdentity: string
) {
  if (!participantIdentity) {
    throw new Error("Participant identity is required");
  }

  const roomService = new RoomServiceClient(
    process.env.LIVEKIT_URL || "",
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET
  );

  await roomService.removeParticipant(roomName, participantIdentity);
  console.log("SIP call hung up", participantIdentity);
}
