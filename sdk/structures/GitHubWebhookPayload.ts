export type GitHubWebhookPayload = {
  action?: undefined | string;
  installation?:
    | undefined
    | {
        id: number;
        account: {
          login: string;
          id: number;
          type: "User" | "Organization";
        };
      };
  repository?:
    | undefined
    | {
        id: number;
        name: string;
        full_name: string;
        owner: {
          login: string;
          id: number;
        };
      };
  ref?: undefined | string;
  before?: undefined | string;
  after?: undefined | string;
  commits?:
    | undefined
    | {
        id: string;
        message: string;
        author: {
          name: string;
          email: string;
        };
      }[];
  pusher?:
    | undefined
    | {
        name: string;
        email: string;
      };
  pull_request?:
    | undefined
    | {
        number: number;
        title: string;
        head: {
          ref: string;
          sha: string;
        };
        base: {
          ref: string;
        };
      };
  repositories_added?:
    | undefined
    | {
        id: number;
        node_id: string;
        name: string;
        full_name: string;
        private: boolean;
      }[];
  repositories_removed?:
    | undefined
    | {
        id: number;
        node_id: string;
        name: string;
        full_name: string;
        private: boolean;
      }[];
  sender?:
    | undefined
    | {
        login: string;
        id: number;
        node_id: string;
        avatar_url: string;
        type: string;
      };
};
