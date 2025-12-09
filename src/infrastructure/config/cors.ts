import cors from "cors";

export const corsMiddleware = cors({
  origin: "*",          
  credentials: true
});
