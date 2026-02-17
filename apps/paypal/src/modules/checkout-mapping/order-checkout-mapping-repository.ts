/**
 * Repository for mapping PayPal order IDs to Saleor checkout IDs.
 * Used by shipping callbacks to look up which Saleor checkout a PayPal order belongs to.
 */

import { Pool } from "pg";

import { createLogger } from "@/lib/logger";

const logger = createLogger("OrderCheckoutMappingRepository");

export interface OrderCheckoutMapping {
  paypalOrderId: string;
  saleorCheckoutId: string;
  saleorApiUrl: string;
  channelId: string;
  createdAt: Date;
}

export interface IOrderCheckoutMappingRepository {
  save(mapping: Omit<OrderCheckoutMapping, "createdAt">): Promise<void>;
  findByPayPalOrderId(paypalOrderId: string): Promise<OrderCheckoutMapping | null>;
  deleteExpired(): Promise<number>;
}

export class PostgresOrderCheckoutMappingRepository implements IOrderCheckoutMappingRepository {
  private constructor(private readonly pool: Pool) {}

  static create(pool: Pool): PostgresOrderCheckoutMappingRepository {
    return new PostgresOrderCheckoutMappingRepository(pool);
  }

  async save(mapping: Omit<OrderCheckoutMapping, "createdAt">): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO paypal_order_checkout_mapping 
         (paypal_order_id, saleor_checkout_id, saleor_api_url, channel_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (paypal_order_id) DO UPDATE SET
           saleor_checkout_id = EXCLUDED.saleor_checkout_id,
           saleor_api_url = EXCLUDED.saleor_api_url,
           channel_id = EXCLUDED.channel_id`,
        [
          mapping.paypalOrderId,
          mapping.saleorCheckoutId,
          mapping.saleorApiUrl,
          mapping.channelId,
        ],
      );

      logger.debug("Saved order-checkout mapping", {
        paypalOrderId: mapping.paypalOrderId,
        saleorCheckoutId: mapping.saleorCheckoutId,
      });
    } catch (error) {
      logger.error("Failed to save order-checkout mapping", {
        paypalOrderId: mapping.paypalOrderId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async findByPayPalOrderId(paypalOrderId: string): Promise<OrderCheckoutMapping | null> {
    try {
      const result = await this.pool.query(
        `SELECT paypal_order_id, saleor_checkout_id, saleor_api_url, channel_id, created_at
         FROM paypal_order_checkout_mapping
         WHERE paypal_order_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
        [paypalOrderId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        paypalOrderId: row.paypal_order_id,
        saleorCheckoutId: row.saleor_checkout_id,
        saleorApiUrl: row.saleor_api_url,
        channelId: row.channel_id,
        createdAt: row.created_at,
      };
    } catch (error) {
      logger.error("Failed to find order-checkout mapping", {
        paypalOrderId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete mappings older than 24 hours (stale checkouts).
   * Returns the number of deleted rows.
   */
  async deleteExpired(): Promise<number> {
    try {
      const result = await this.pool.query(
        `DELETE FROM paypal_order_checkout_mapping
         WHERE created_at < NOW() - INTERVAL '24 hours'`,
      );

      const count = result.rowCount ?? 0;

      if (count > 0) {
        logger.info("Cleaned up expired order-checkout mappings", { count });
      }

      return count;
    } catch (error) {
      logger.error("Failed to delete expired mappings", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
