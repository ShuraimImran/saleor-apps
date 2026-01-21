import { Pool } from "pg";
import { Result, ok, err } from "neverthrow";
import { BaseError } from "@/lib/errors";

/**
 * Customer vault record - maps Saleor customer to PayPal vault customer
 */
export interface CustomerVaultRecord {
  id: string;
  saleorApiUrl: string;
  saleorUserId: string;
  paypalCustomerId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create customer vault request
 */
export interface CreateCustomerVaultRequest {
  saleorApiUrl: string;
  saleorUserId: string;
  paypalCustomerId: string;
}

/**
 * Customer Vault Repository Errors
 */
export class CustomerVaultRepositoryError extends BaseError.subclass("CustomerVaultRepositoryError") {}

/**
 * Repository interface for managing customer vault mappings
 */
export interface ICustomerVaultRepository {
  create(
    request: CreateCustomerVaultRequest
  ): Promise<Result<CustomerVaultRecord, CustomerVaultRepositoryError>>;

  getOrCreate(
    saleorApiUrl: string,
    saleorUserId: string
  ): Promise<Result<CustomerVaultRecord, CustomerVaultRepositoryError>>;

  getBySaleorUserId(
    saleorApiUrl: string,
    saleorUserId: string
  ): Promise<Result<CustomerVaultRecord | null, CustomerVaultRepositoryError>>;

  getByPayPalCustomerId(
    saleorApiUrl: string,
    paypalCustomerId: string
  ): Promise<Result<CustomerVaultRecord | null, CustomerVaultRepositoryError>>;

  delete(
    saleorApiUrl: string,
    saleorUserId: string
  ): Promise<Result<void, CustomerVaultRepositoryError>>;
}

/**
 * PostgreSQL implementation of Customer Vault Repository
 */
export class PostgresCustomerVaultRepository implements ICustomerVaultRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  static create(pool: Pool): PostgresCustomerVaultRepository {
    return new PostgresCustomerVaultRepository(pool);
  }

  private mapRowToRecord(row: any): CustomerVaultRecord {
    return {
      id: row.id,
      saleorApiUrl: row.saleor_api_url,
      saleorUserId: row.saleor_user_id,
      paypalCustomerId: row.paypal_customer_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(
    request: CreateCustomerVaultRequest
  ): Promise<Result<CustomerVaultRecord, CustomerVaultRepositoryError>> {
    try {
      const query = `
        INSERT INTO paypal_customer_vault (
          saleor_api_url, saleor_user_id, paypal_customer_id
        )
        VALUES ($1, $2, $3)
        RETURNING *
      `;

      const values = [
        request.saleorApiUrl,
        request.saleorUserId,
        request.paypalCustomerId,
      ];

      const result = await this.pool.query(query, values);
      return ok(this.mapRowToRecord(result.rows[0]));
    } catch (error: any) {
      // Handle unique constraint violation (customer already exists)
      if (error.code === "23505") {
        return err(
          new CustomerVaultRepositoryError(`Customer vault mapping already exists for user: ${request.saleorUserId}`, {
            cause: error,
          })
        );
      }
      return err(
        new CustomerVaultRepositoryError(`Failed to create customer vault mapping: ${error.message}`, {
          cause: error,
        })
      );
    }
  }

  /**
   * Get existing customer vault record or create one if it doesn't exist.
   * Uses Saleor user ID as PayPal customer ID (Option A design decision).
   */
  async getOrCreate(
    saleorApiUrl: string,
    saleorUserId: string
  ): Promise<Result<CustomerVaultRecord, CustomerVaultRepositoryError>> {
    // First, try to get existing record
    const existingResult = await this.getBySaleorUserId(saleorApiUrl, saleorUserId);

    if (existingResult.isErr()) {
      return err(existingResult.error);
    }

    if (existingResult.value !== null) {
      return ok(existingResult.value);
    }

    // Create new record - use saleorUserId as paypalCustomerId (Option A)
    return this.create({
      saleorApiUrl,
      saleorUserId,
      paypalCustomerId: saleorUserId,
    });
  }

  async getBySaleorUserId(
    saleorApiUrl: string,
    saleorUserId: string
  ): Promise<Result<CustomerVaultRecord | null, CustomerVaultRepositoryError>> {
    try {
      const query = `
        SELECT * FROM paypal_customer_vault
        WHERE saleor_api_url = $1 AND saleor_user_id = $2
      `;

      const result = await this.pool.query(query, [saleorApiUrl, saleorUserId]);

      if (result.rows.length === 0) {
        return ok(null);
      }

      return ok(this.mapRowToRecord(result.rows[0]));
    } catch (error: any) {
      return err(
        new CustomerVaultRepositoryError(`Failed to get customer vault mapping: ${error.message}`, {
          cause: error,
        })
      );
    }
  }

  async getByPayPalCustomerId(
    saleorApiUrl: string,
    paypalCustomerId: string
  ): Promise<Result<CustomerVaultRecord | null, CustomerVaultRepositoryError>> {
    try {
      const query = `
        SELECT * FROM paypal_customer_vault
        WHERE saleor_api_url = $1 AND paypal_customer_id = $2
      `;

      const result = await this.pool.query(query, [saleorApiUrl, paypalCustomerId]);

      if (result.rows.length === 0) {
        return ok(null);
      }

      return ok(this.mapRowToRecord(result.rows[0]));
    } catch (error: any) {
      return err(
        new CustomerVaultRepositoryError(`Failed to get customer vault mapping: ${error.message}`, {
          cause: error,
        })
      );
    }
  }

  async delete(
    saleorApiUrl: string,
    saleorUserId: string
  ): Promise<Result<void, CustomerVaultRepositoryError>> {
    try {
      const query = `
        DELETE FROM paypal_customer_vault
        WHERE saleor_api_url = $1 AND saleor_user_id = $2
      `;

      await this.pool.query(query, [saleorApiUrl, saleorUserId]);
      return ok(undefined);
    } catch (error: any) {
      return err(
        new CustomerVaultRepositoryError(`Failed to delete customer vault mapping: ${error.message}`, {
          cause: error,
        })
      );
    }
  }
}
