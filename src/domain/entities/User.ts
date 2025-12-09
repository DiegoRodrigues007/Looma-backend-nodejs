export interface UserProps {
  id: string;
  email: string;
  userName?: string | null;
  name: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

// Dados mínimos pra criar um usuário novo a partir da aplicação
export interface CreateUserProps {
  email: string;
  userName?: string | null;
  name: string;
  passwordHash: string;
}

export class User {
  private props: UserProps;

  private constructor(props: UserProps) {
    this.props = props;
  }

  // Fábrica para criar um novo usuário de domínio
  static create(data: CreateUserProps, id: string, now: Date): User {
    if (!data.email.includes("@")) {
      throw new Error("Email inválido.");
    }

    if (!data.name.trim()) {
      throw new Error("Nome não pode ser vazio.");
    }

    return new User({
      id,
      email: data.email,
      userName: data.userName ?? null,
      name: data.name,
      passwordHash: data.passwordHash,
      createdAt: now,
      updatedAt: now
    });
  }

  // Fábrica para reidratar a entidade a partir do banco (Prisma)
  static fromPersistence(props: UserProps): User {
    return new User(props);
  }

  // Getters (somente leitura de fora)
  get id() { return this.props.id; }
  get email() { return this.props.email; }
  get userName() { return this.props.userName ?? null; }
  get name() { return this.props.name; }
  get passwordHash() { return this.props.passwordHash; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  // Regras de negócio

  changeName(name: string) {
    if (!name.trim()) throw new Error("Nome não pode ser vazio");
    this.props.name = name.trim();
    this.touchUpdatedAt();
  }

  changeEmail(email: string) {
    if (!email.includes("@")) throw new Error("Email inválido.");
    this.props.email = email.toLowerCase();
    this.touchUpdatedAt();
  }

  changeUserName(userName: string | null) {
    if (userName && !userName.trim()) {
      throw new Error("UserName não pode ser vazio.");
    }
    this.props.userName = userName?.trim() ?? null;
    this.touchUpdatedAt();
  }

  changePasswordHash(newHash: string) {
    if (!newHash) throw new Error("Hash de senha inválido.");
    this.props.passwordHash = newHash;
    this.touchUpdatedAt();
  }

  // Atualiza o updatedAt sempre que algo muda
  private touchUpdatedAt() {
    this.props.updatedAt = new Date();
  }

  // Útil para o repositório salvar no prisma
  toPrimitives(): UserProps {
    return { ...this.props };
  }
}
