import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { ApiError, authApi, clearStoredToken, getStoredToken, settingsApi, storeToken } from "../lib/api";
import { getDefaultPermissionsForRole, mergePermissionMap } from "../lib/permissions";
import type { AuthUser, PermissionMap } from "../types/api";

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  effectivePermissions: PermissionMap | null;
  isLoading: boolean;
  isLoadingPermissions: boolean;
  login: (credentials: { username: string; password: string }) => Promise<AuthUser>;
  logout: () => void;
  refreshUser: () => Promise<AuthUser | null>;
  refreshPermissions: () => Promise<PermissionMap | null>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [effectivePermissions, setEffectivePermissions] = useState<PermissionMap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(true);
  const forceLogout = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setEffectivePermissions(null);
    setIsLoadingPermissions(false);
  }, []);

  useEffect(() => {
    const existingToken = getStoredToken();
    if (!existingToken) {
      setIsLoading(false);
      setIsLoadingPermissions(false);
      return;
    }

    let isMounted = true;
    const bootstrapAuthState = async () => {
      try {
        const currentUser = await authApi.me(existingToken);
        if (!isMounted) return;
        setToken(existingToken);
        setUser(currentUser);
        setIsLoadingPermissions(true);
        try {
          const response = await settingsApi.getPermissionsEffective(existingToken);
          if (!isMounted) return;
          setEffectivePermissions(mergePermissionMap(response.modules));
        } catch {
          if (!isMounted) return;
          setEffectivePermissions(getDefaultPermissionsForRole(currentUser.role));
        } finally {
          if (isMounted) {
            setIsLoadingPermissions(false);
          }
        }
      } catch {
        if (!isMounted) return;
        forceLogout();
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    void bootstrapAuthState();

    return () => {
      isMounted = false;
    };
  }, [forceLogout]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let isMounted = true;
    const validateSession = async () => {
      try {
        const currentUser = await authApi.me(token);
        if (!isMounted) {
          return;
        }
        setUser(currentUser);
        try {
          const permissionsResponse = await settingsApi.getPermissionsEffective(token);
          if (!isMounted) {
            return;
          }
          setEffectivePermissions(mergePermissionMap(permissionsResponse.modules));
        } catch {
          if (!isMounted) {
            return;
          }
          setEffectivePermissions(getDefaultPermissionsForRole(currentUser.role));
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          forceLogout();
        }
      }
    };

    const onFocus = () => {
      void validateSession();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void validateSession();
      }
    };

    const intervalId = window.setInterval(() => {
      void validateSession();
    }, 15000);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [forceLogout, token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      effectivePermissions,
      isLoading,
      isLoadingPermissions,
      login: async (credentials) => {
        const response = await authApi.login(credentials);
        storeToken(response.access_token);
        setToken(response.access_token);
        setUser(response.user);
        setIsLoadingPermissions(true);
        try {
          const permissionsResponse = await settingsApi.getPermissionsEffective(response.access_token);
          setEffectivePermissions(mergePermissionMap(permissionsResponse.modules));
        } catch {
          setEffectivePermissions(getDefaultPermissionsForRole(response.user.role));
        } finally {
          setIsLoadingPermissions(false);
        }
        return response.user;
      },
      logout: () => {
        forceLogout();
      },
      refreshUser: async () => {
        const currentToken = getStoredToken();
        if (!currentToken) {
          forceLogout();
          return null;
        }

        const currentUser = await authApi.me(currentToken);
        setToken(currentToken);
        setUser(currentUser);
        setIsLoadingPermissions(true);
        try {
          const permissionsResponse = await settingsApi.getPermissionsEffective(currentToken);
          setEffectivePermissions(mergePermissionMap(permissionsResponse.modules));
        } catch {
          setEffectivePermissions(getDefaultPermissionsForRole(currentUser.role));
        } finally {
          setIsLoadingPermissions(false);
        }
        return currentUser;
      },
      refreshPermissions: async () => {
        const currentToken = getStoredToken();
        if (!currentToken || !user) {
          setEffectivePermissions(null);
          setIsLoadingPermissions(false);
          return null;
        }
        setIsLoadingPermissions(true);
        try {
          const permissionsResponse = await settingsApi.getPermissionsEffective(currentToken);
          const nextPermissions = mergePermissionMap(permissionsResponse.modules);
          setEffectivePermissions(nextPermissions);
          return nextPermissions;
        } catch {
          const fallback = getDefaultPermissionsForRole(user.role);
          setEffectivePermissions(fallback);
          return fallback;
        } finally {
          setIsLoadingPermissions(false);
        }
      },
    }),
    [effectivePermissions, forceLogout, isLoading, isLoadingPermissions, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
