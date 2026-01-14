import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { listInstagramPosts } from "../controllers/InstagramPostsController";

const router = Router();

router.get("/posts", authMiddleware, listInstagramPosts);

export default router;
