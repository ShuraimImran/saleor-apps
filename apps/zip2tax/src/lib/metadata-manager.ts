import { Client } from "urql";

import { 
  DeleteAppMetadataDocument,
  FetchAppDetailsDocument, 
  type FetchAppDetailsQuery,
  type MetadataItem,
  UpdatePrivateMetadataDocument} from "../../generated/graphql";

type MetadataEntry = {
  key: string;
  value: string;
};

export async function fetchAllMetadata(client: Pick<Client, "query">): Promise<MetadataEntry[]> {
  console.log("Fetching all metadata");
  console.log("Client:", client);
  const { error, data } = await client
    .query<FetchAppDetailsQuery>(FetchAppDetailsDocument, {})
    .toPromise();

  if (error) {
    console.error("Error fetching metadata:", error);
    return [];
  }

  const metadata = data?.app?.privateMetadata.map((md) => ({ key: md.key, value: md.value })) || [];
  console.log("Fetched metadata entries:", metadata.length);
  return metadata;
}

export async function updateMetadata(
  client: Pick<Client, "mutation">,
  metadata: MetadataEntry[],
  appId: string,
) {
  console.log("Updating metadata for appId:", appId);
  console.log("Metadata entries:", metadata.length);
  
  const { error: mutationError, data: mutationData } = await client
    .mutation(UpdatePrivateMetadataDocument, {
      id: appId,
      input: metadata,
    })
    .toPromise();

  if (mutationError) {
    console.error("Metadata update error:", mutationError);
    throw new Error("Error during metadata update: " + mutationError.message);
  }

  console.log("Metadata update successful");
  return (
    mutationData?.updatePrivateMetadata?.item?.privateMetadata.map((md) => ({
      key: md.key,
      value: md.value,
    })) || []
  );
}

export async function deleteMetadata(
  client: Pick<Client, "mutation">,
  keys: string[],
  appId: string,
): Promise<void> {
  const { error } = await client
    .mutation(DeleteAppMetadataDocument, {
      id: appId,
      keys,
    })
    .toPromise();

  if (error) {
    throw new Error("Error during metadata deletion: " + error.message);
  }
}