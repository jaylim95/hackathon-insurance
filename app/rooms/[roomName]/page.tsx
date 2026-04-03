import * as React from 'react';
import { PageClientImpl } from './PageClientImpl';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomName: string }>;
  searchParams: Promise<{
    name?: string;
    phone?: string;
    trunk?: string;
    autodial?: string;
  }>;
}) {
  const { roomName } = await params;
  const resolvedSearchParams = await searchParams;

  return (
    <PageClientImpl
      roomName={roomName}
      participantName={resolvedSearchParams.name}
      initialPhoneNumber={resolvedSearchParams.phone}
      initialSipTrunkId={resolvedSearchParams.trunk}
      autoDial={resolvedSearchParams.autodial === 'true'}
    />
  );
}
