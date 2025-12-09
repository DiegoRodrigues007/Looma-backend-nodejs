import { User } from "../entities/User";

export interface IUserRepository {
  findByEmailOrUserName(emailOrUserName: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(user: User): Promise<void>;
}
