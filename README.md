# Looma Backend (Node.js + Clean Architecture)

Backend em **Node.js + TypeScript** usando **Clean Architecture**, **Prisma** e **PostgreSQL**, com autenticação via **JWT** e integração de login com **Instagram / Facebook**.
---

## 1. Tecnologias utilizadas

- **Node.js** + **TypeScript**
- **Express** – servidor HTTP
- **Prisma ORM** – acesso ao PostgreSQL
- **PostgreSQL** – banco de dados principal
- **JWT (JSON Web Token)** – autenticação e autorização
- **bcrypt** (ou similar) – hash de senha
- **dotenv** – leitura das variáveis de ambiente do `.env`
- **cors** – configuração de CORS pro frontend
- **Swagger (OpenAPI)** – documentação da API em `/swagger`
- Integração com **Facebook Login + Instagram Graph API** para login com Instagram

---

## 2. Estrutura de pastas (Clean Architecture)

A estrutura base fica mais ou menos assim:

```txt
prisma/
  schema.prisma
  migrations/

src/
  domain/
  application/
  infrastructure/
  presentation/
    http/
      controllers/
      routes/
      middlewares/
      docs/
      app.ts
      server.ts
  composition/
    instagramComposition.ts
    authComposition.ts
```

### 2.1. `prisma/`

- **`schema.prisma`**  
  Aqui fica o **modelo do banco** (tabelas, colunas, relacionamentos) em linguagem do Prisma.
- **`migrations/`**  
  Cada vez que você roda `npx prisma migrate dev`, o Prisma cria uma pasta aqui com o SQL pra atualizar o banco.

> Resumindo: essa pasta é o “mapa” do banco e o histórico de mudanças de schema.

---

### 2.2. `src/domain/` (Domínio)

É o **coração da regra de negócio**.

Aqui normalmente ficam:

- **Entidades** (`User`, `InstagramAccount`, etc.)  
- **Interfaces / contratos** de alto nível (ex: `IUserRepository`, `IInstagramTokenStore`).

Essa camada:

- **Não conhece Express, Prisma, banco, nada** de infra.
- É o “mundo ideal” do negócio.

Se amanhã você trocar Prisma por Sequelize ou trocar Express por Fastify, essa pasta quase não muda.

---

### 2.3. `src/application/` (Casos de uso)

Aqui entram os **use cases** / **serviços de aplicação**:

- Ex: `AuthenticateUserUseCase`, `ConnectInstagramUseCase`, `DisconnectInstagramUseCase`, etc.
- Eles orquestram:
  - chamadas para os repositórios do domínio (consultam/salvam no banco),
  - regras de negócio,
  - validações mais de “fluxo”.

Essa camada enxerga:

- o **domínio** (`domain`)  
- e as **interfaces** de repositórios/serviços (mas não as implementações concretas).

> Pensa nela como: “o que o sistema faz”, não “como ele faz tecnicamente”.

---

### 2.4. `src/infrastructure/` (Infraestrutura)

Aqui entram os **detalhes técnicos**:

- **Prisma Client** (normalmente em `infrastructure/prisma/PrismaClient.ts` ou algo assim).
- **Repositórios concretos** que implementam as interfaces do domínio:
  - `PrismaUserRepository`
  - `PrismaInstagramTokenRepository`
- **Serviços externos**:
  - chamadas HTTP pro Facebook / Instagram;
  - provedores de e-mail, cache, fila, etc.

Essa camada sabe falar com:

- Banco de dados
- HTTP externos (Instagram/Facebook)
- Serviços de terceiros

> Se um dia você trocar o banco ou a API externa, você mexe principalmente aqui.

---

### 2.5. `src/presentation/http/` (Apresentação / HTTP)

É a camada que fala com o “mundo de fora” via **HTTP**:

- **`controllers/`**  
  Recebem a `req` e `res`, chamam os casos de uso da aplicação e devolvem as respostas.  
  Ex:
  - `AuthController`
  - `InstagramAuthController`

- **`routes/`**  
  Declaram os endpoints:
  - `auth.routes.ts` → `/auth/login`, `/auth/register`, etc.
  - `instagram.routes.ts` → `/auth/instagram/start`, `/auth/instagram/callback`, `/auth/instagram/status`, `/auth/instagram/disconnect`

- **`middlewares/`**  
  Coisas como:
  - autenticação por JWT,
  - CORS,
  - tratamento de erros.

- **`docs/`**  
  Configuração do Swagger / OpenAPI pra gerar a documentação da API.

- **`app.ts`**  
  - Cria a instância do `express()`
  - Configura `express.json()`, CORS, Swagger, rotas (`app.use("/auth/instagram", instagramRouter)` etc.)

- **`server.ts`**  
  - Só sobe o servidor (`app.listen(PORT, ...)`).

> Resumindo: essa camada traduz HTTP → chamadas de casos de uso → HTTP de volta.

---

### 2.6. `src/composition/`

Esses arquivos (`instagramComposition.ts`, `authComposition.ts` etc.) são as **“montagens” dos objetos**:

- Criam as instâncias de:
  - Repositórios concretos (Prisma…),
  - Serviços (JWT, Instagram/Facebook),
  - Casos de uso,
  - Controllers.
- Fazem a “injeção de dependência manual”.

Exemplo típico de composição:

```ts
export function makeInstagramAuthController() {
  const prismaClient = new PrismaClient();
  const instagramTokenRepo = new PrismaInstagramTokenRepository(prismaClient);
  const facebookService = new FacebookInstagramAuthService(/* ...envs */);
  const useCase = new InstagramLoginUseCase(instagramTokenRepo, facebookService);
  return new InstagramAuthController(useCase);
}
```

---

## 3. Arquivo `.env` (configuração do ambiente)

Na raiz do projeto do backend, crie um arquivo chamado **`.env`**:

```env
# ==========================
# Server
# ==========================
PORT=7031

# ==========================
# Database (PostgreSQL + Prisma)
# ==========================
DATABASE_URL="postgresql://postgres:SUA_SENHA_AQUI@localhost:5432/looma?schema=public"

# ==========================
# JWT / Auth
# ==========================
JWT_SECRET="coloque_aqui_uma_chave_bem_grande_e_aleatoria"
JWT_ISSUER="Looma"
JWT_AUDIENCE="LoomaUsers"
JWT_ACCESS_TOKEN_MINUTES=30
JWT_REFRESH_TOKEN_DAYS=7

# ==========================
# CORS
# ==========================
# Durante o desenvolvimento pode deixar *, depois restringe pro domínio do front
CORS_ORIGIN="*"

# ==========================
# Facebook / Instagram Login
# (espelhando o que já existia no backend .NET)
# ==========================
FACEBOOK_AUTHORIZE_URL="https://www.facebook.com/v21.0/dialog/oauth"
FACEBOOK_TOKEN_URL="https://graph.facebook.com/v21.0/oauth/access_token"
INSTAGRAM_GRAPH_BASE_URL="https://graph.facebook.com/v21.0"

FACEBOOK_CLIENT_ID=24251132131229008
FACEBOOK_CLIENT_SECRET=8439433dd716d203f395e5018cc91659

# IMPORTANTE: essa URL precisa bater com o que está configurado no app do Facebook
FACEBOOK_REDIRECT_URI="https://localhost:7031/auth/instagram/callback"

FACEBOOK_SCOPES="public_profile,email,pages_show_list,pages_read_engagement,pages_read_user_content,instagram_basic,instagram_manage_insights"
```

> **Nunca** versionar esse `.env` no Git. Deixa o `.gitignore` ignorando ele.

---

## 4. Passo a passo para configurar o projeto

### 4.1. Pré-requisitos

- **Node.js** (versão 18+ de preferência)
- **npm** ou **yarn**
- **PostgreSQL** rodando localmente (porta 5432)
  - usuário padrão: `postgres`
  - senha: a que você definiu na instalação
- **DBeaver** (opcional, mas útil) pra gerenciar o banco

---

### 4.2. Clonar e instalar dependências

```bash
# clonar o repositório
git clone <url-do-repo>

cd looma-backend-nodejs

# instalar dependências
npm install
# ou
yarn
```

Criar o `.env` conforme explicado acima.

---

### 4.3. Criar o banco `looma` no PostgreSQL

Você pode criar direto no DBeaver ou via linha de comando.

#### Opção A: via DBeaver (GUI)

1. Abra o **DBeaver**.
2. Crie uma conexão PostgreSQL:
   - Host: `localhost`
   - Porta: `5432`
   - Database: `postgres`
   - Usuário: `postgres`
   - Senha: sua senha
3. Conecte.
4. Se ao tentar criar o banco aparecer o erro:

   > Cannot create a database when multi-database mode is disabled.  
   > Enable 'Show all databases' option in the connection settings.

   então:
   - Clique com botão direito na conexão → **Editar conexão…**
   - Vá em **Configurações do driver** / **Avançado** (pode variar um pouco pela versão)
   - Procure a opção **“Show all databases” / “Exibir todos os bancos”** e marque.
   - Salve, desconecte e conecte de novo.

5. Agora:
   - Clique com o botão direito em **Bancos de dados** → **Criar** → **Banco de dados**.
   - Nome: `looma`.
   - Ok.
6. Atualize a árvore de bancos → deve aparecer o banco `looma`.

#### Opção B: via linha de comando (psql)

Se o `psql` estiver instalado e reconhecido, você pode usar:

```bash
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE looma;"
```

Se der erro de “psql não é reconhecido”, é porque o binário do PostgreSQL não está no PATH – nesse caso, use a opção A (DBeaver) que é mais simples.

---

### 4.4. Rodar as migrations do Prisma

Com o banco `looma` criado e o `.env` apontando corretamente (`DATABASE_URL`), rode:

```bash
npx prisma migrate dev --name init
```

Isso vai:

- criar as tabelas no banco (User, InstagramToken, etc.);
- gerar o **Prisma Client** em `node_modules/.prisma` pra ser usado pelo código.

Se quiser só validar o schema, você pode rodar antes:

```bash
npx prisma validate
```

---

### 4.5. Subir o servidor

Em modo desenvolvimento:

```bash
npm run dev
# ou
yarn dev
```

Normalmente o servidor sobe em:

- `http://localhost:7031`

Você deve conseguir acessar:

- `http://localhost:7031/swagger` – documentação interativa da API
- `http://localhost:7031/health` – endpoint simples de saúde

---

## 5. Endpoints principais (Instagram)

Os endpoints de Instagram costumam ficar montados assim:

Base: `https://localhost:7031/auth/instagram`

- **`GET /auth/instagram/start`**
  - Inicia o fluxo de login.
  - Query param opcional: `redirect=true` (default)
    - `true`: o backend já redireciona direto pro Instagram.
    - `false`: o backend retorna a URL pra você redirecionar manualmente no front.

- **`GET /auth/instagram/callback`**
  - Endpoint que o Facebook/Instagram chama depois que o usuário autoriza.
  - Recebe `code` e `state`.
  - Troca o `code` por access token, salva tokens no banco (tabela `InstagramTokens` / `InstagramAccounts`) e redireciona de volta pro front.

- **`GET /auth/instagram/status`**
  - Retorna se o usuário atual tem Instagram conectado:

    ```json
    { "connected": true }
    ```

- **`POST /auth/instagram/disconnect`**
  - Remove/desvincula os tokens do Instagram do usuário logado.

Lembrando que no frontend você provavelmente aponta para `/api/instagram/...` e o Vite/React faz proxy para o backend em `localhost:7031`.

---

## 6. Fluxo resumido do login com Instagram

1. Front chama:  
   `GET /api/instagram/start?redirect=true` → redireciona para `https://www.facebook.com/v21.0/dialog/oauth?...`
2. Usuário faz login/aceita permissões no Instagram / Facebook.
3. Facebook chama:  
   `https://localhost:7031/auth/instagram/callback?code=...&state=...`
4. Backend:
   - valida `state`;
   - troca `code` por access token no `FACEBOOK_TOKEN_URL`;
   - consulta dados da página/conta no `INSTAGRAM_GRAPH_BASE_URL`;
   - grava tokens no banco;
   - redireciona o usuário de volta para o frontend (ex: `http://localhost:5173/settings?instagram=connected`).
5. Front lê `instagram=connected` na URL, atualiza o estado e mostra “Conectado”.

---

Pronto! Com isso você tem uma visão geral da arquitetura, sabe o que cada pasta faz, como configurar o `.env`, criar o banco, rodar as migrations, subir o servidor e entender o fluxo de login com Instagram.
