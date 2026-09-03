import { createApp } from 'vue';
import { IonicVue } from '@ionic/vue';
import { createRouter, createWebHistory } from '@ionic/vue-router';
import App from './App.vue';
import AuthView from './views/AuthView.vue';
import AdminDashboard from './views/AdminDashboard.vue';
import MemberWelcome from './views/MemberWelcome.vue';
import EinrichtungenView from './views/EinrichtungenView.vue';
import StreckeneintraegeView from './views/StreckeneintraegeView.vue';

import 'leaflet/dist/leaflet.css';
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';
import '@ionic/vue/css/padding.css';
import './theme/variables.css';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

/**
 * Decodes the JWT payload stored in localStorage without verifying the signature.
 * Verification happens server-side; this is only used for client-side routing decisions.
 */
function getTokenPayload() {
   const token = localStorage.getItem('accessToken');
   if (!token) return null;
   try {
      return JSON.parse(atob(token.split('.')[1])) as {
         accountType: 'systemAdmin' | 'member';
         exp: number;
         hasRevierAdminAccess?: boolean;
      };
   } catch {
      return null;
   }
}

/**
 * Silently renews the JWT on app startup using the /auth/refresh endpoint.
 * This implements a sliding-window session: the 7-day clock resets every time
 * the app is opened, so users only need to re-login after 7 days of inactivity.
 */
async function refreshTokenOnStartup() {
   const token = localStorage.getItem('accessToken');
   if (!token) return;
   try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { exp: number };
      // Skip refresh if the token is already expired (login required).
      if (Date.now() / 1000 > payload.exp) return;
      const response = await fetch(`${apiUrl}/auth/refresh`, {
         method: 'POST',
         headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
         const data = (await response.json()) as { accessToken?: string };
         if (data.accessToken)
            localStorage.setItem('accessToken', data.accessToken);
      }
   } catch {
      // ignore – proceed with existing token
   }
}

const router = createRouter({
   history: createWebHistory(),
   routes: [
      { path: '/', component: AuthView },
      {
         path: '/dashboard',
         component: AdminDashboard,
         // Systemadmins and users with at least one Revieradmin membership can access it.
         meta: { requiresRole: 'admin' },
      },
      {
         path: '/reviere/karte',
         component: MemberWelcome,
         props: { section: 'map' },
         meta: { requiresAuth: true },
      },
      {
         path: '/reviere/mitglieder',
         component: MemberWelcome,
         props: { section: 'members' },
         meta: { requiresAuth: true },
      },
      {
         path: '/reviere/einrichtungen',
         component: EinrichtungenView,
         meta: { requiresAuth: true },
      },
      {
         path: '/reviere/strecke',
         component: StreckeneintraegeView,
         meta: { requiresAuth: true },
      },
      { path: '/welcome', redirect: '/reviere/karte' },
   ],
});

/**
 * Global navigation guard.
 * - Redirects authenticated users away from '/' to their home route.
 * - Blocks unauthenticated/expired users from protected routes.
 * - Admin dashboard requires a system account or an active Revieradmin membership.
 */
router.beforeEach((to) => {
   const requiresRole = to.meta.requiresRole as string | undefined;
   const requiresAuth = to.meta.requiresAuth as boolean | undefined;
   const payload = getTokenPayload();
   const isAdminUser = payload
      ? payload.accountType === 'systemAdmin' || payload.hasRevierAdminAccess === true
      : false;
   // Redirect already-authenticated users away from the auth page.
   if (to.path === '/' && payload && Date.now() / 1000 < payload.exp) {
      return isAdminUser ? '/dashboard' : '/reviere/karte';
   }
   if (requiresRole === 'admin') {
      if (!payload || Date.now() / 1000 > payload.exp) return '/';
      if (!isAdminUser) return '/';
   } else if (requiresAuth) {
      if (!payload || Date.now() / 1000 > payload.exp) return '/';
   }
   return true;
});

// Refresh the token before mounting so the first render has a valid JWT.
refreshTokenOnStartup().then(() => {
   createApp(App).use(IonicVue).use(router).mount('#app');
});
