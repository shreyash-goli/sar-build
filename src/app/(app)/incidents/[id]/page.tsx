import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { IncidentDetailView } from "@/components/risks/incident-detail";
import { loadIncident } from "@/lib/incidents/load";

export async function generateMetadata({ params }: PageProps<"/incidents/[id]">): Promise<Metadata> {
  const { id } = await params;
  // loadIncident may throw for an unreadable snapshot; the page's error boundary handles that.
  const incident = await loadIncident(id).catch(() => null);
  return { title: incident ? incident.title : "Incident not found" };
}

export default async function Page({ params }: PageProps<"/incidents/[id]">) {
  await connection();
  const { id } = await params;
  const incident = await loadIncident(id);
  if (!incident) notFound();
  return <IncidentDetailView incident={incident} />;
}
