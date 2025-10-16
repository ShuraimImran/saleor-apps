import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  overwrite: true,
  schema: "./graphql/schema.graphql",
  documents: ["graphql/**/*.graphql", "src/**/*.ts", "src/**/*.tsx"],
  generates: {
    "generated/graphql.ts": {
      plugins: ["typescript", "typescript-operations", "typed-document-node"],
      config: {
        strictScalars: true,
        scalars: {
          Decimal: "string",
          DateTime: "string",
          Date: "string",
          JSONString: "string",
          UUID: "string",
          Upload: "File",
          PositiveDecimal: "string",
          Metadata: "Record<string, string>",
          GenericScalar: "any",
        },
      },
    },
  },
  config: {
    useIndexSignature: true,
  },
};

export default config;