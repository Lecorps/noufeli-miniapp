import { query } from "./_generated/server";
import { v } from "convex/values";

export const getFlow = query({
  args: { chatId: v.number() },
  handler: async (ctx, args) => {
    // Return null for now - flow functionality to be implemented
    return null;
  },
});
