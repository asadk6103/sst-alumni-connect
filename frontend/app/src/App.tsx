import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { homeFor, useAuth } from '@/lib/auth';
import { FullPageSpinner, useSite } from '@/lib/site';
import { AdminLayout, ADMIN_NAV } from '@/layouts/AdminLayout';
import { PortalLayout } from '@/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/display';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, VerifyEmailPage } from '@/pages/auth/pages';
import { SettingsPage } from '@/pages/portal/Settings';
import { FeedPage } from '@/pages/portal/Feed';

const RegisterPage = lazy(() => import('@/pages/auth/Register').then((m) => ({ default: m.RegisterPage })));
const DirectoryPage = lazy(() => import('@/pages/portal/Directory').then((m) => ({ default: m.DirectoryPage })));
const ProfileViewPage = lazy(() => import('@/pages/portal/Profile').then((m) => ({ default: m.ProfileViewPage })));
const MyProfilePage = lazy(() => import('@/pages/portal/MyProfile').then((m) => ({ default: m.MyProfilePage })));
const MyProfileViewPage = lazy(() => import('@/pages/portal/Profile').then((m) => ({ default: m.MyProfileViewPage })));
const MyNetworkPage = lazy(() => import('@/pages/portal/Network').then((m) => ({ default: m.MyNetworkPage })));
const FindAlumniPage = lazy(() => import('@/pages/portal/Network').then((m) => ({ default: m.FindAlumniPage })));
const SavedPostsPage = lazy(() => import('@/pages/portal/Feed').then((m) => ({ default: m.SavedPostsPage })));
const community = () => import('@/pages/portal/Community');
const communities = () => import('./pages/portal/Communities');
const SupportAdminPage = lazy(() => import('./pages/admin/Support').then((m) => ({ default: m.SupportAdminPage })));
const ResourcesAdminPage = lazy(() => import('./pages/admin/Resources').then((m) => ({ default: m.ResourcesAdminPage })));
const ResourcesPage = lazy(() => import('./pages/portal/Resources').then((m) => ({ default: m.ResourcesPage })));
const GroupsPage = lazy(() => communities().then((m) => ({ default: m.GroupsPage })));
const GroupPage = lazy(() => communities().then((m) => ({ default: m.GroupPage })));
const PostPage = lazy(() => community().then((m) => ({ default: m.PostPage })));
const MessagesPage = lazy(() => import('@/pages/portal/Messages').then((m) => ({ default: m.MessagesPage })));
const evp = () => import('@/pages/portal/Events');
const EventsPage = lazy(() => evp().then((m) => ({ default: m.EventsPage })));
const EventPage = lazy(() => evp().then((m) => ({ default: m.EventPage })));
const jbp = () => import('@/pages/portal/Jobs');
const JobsPage = lazy(() => jbp().then((m) => ({ default: m.JobsPage })));
const JobPage = lazy(() => jbp().then((m) => ({ default: m.JobPage })));
const PostJobPage = lazy(() => jbp().then((m) => ({ default: m.PostJobPage })));
const JobApplicationsPage = lazy(() => jbp().then((m) => ({ default: m.JobApplicationsPage })));
const mnp = () => import('@/pages/portal/Mentorship');
const MentorshipPage = lazy(() => mnp().then((m) => ({ default: m.MentorshipPage })));
const MentorshipRequestPage = lazy(() => mnp().then((m) => ({ default: m.MentorshipRequestPage })));
const gvp = () => import('@/pages/portal/Giving');
const GivingPage = lazy(() => gvp().then((m) => ({ default: m.GivingPage })));
const CampaignPage = lazy(() => gvp().then((m) => ({ default: m.CampaignPage })));
const GalleryPage = lazy(() => gvp().then((m) => ({ default: m.GalleryPage })));
const AlbumPage = lazy(() => gvp().then((m) => ({ default: m.AlbumPage })));
const NotificationsPage = lazy(() => import('@/pages/portal/Notifications').then((m) => ({ default: m.NotificationsPage })));
const NewsletterPage = lazy(() => import('@/pages/auth/Newsletter').then((m) => ({ default: m.NewsletterPage })));
const acp = () => import('@/pages/portal/Achievements');
const AchievementsPage = lazy(() => acp().then((m) => ({ default: m.AchievementsPage })));
const AchievementPage = lazy(() => acp().then((m) => ({ default: m.AchievementPage })));

// Administration and setup screens load on demand (smaller first load for members).
const SetupWizard = lazy(() => import('@/pages/setup/SetupWizard').then((m) => ({ default: m.SetupWizard })));
const AdminDashboard = lazy(() => import('@/pages/admin/Dashboard').then((m) => ({ default: m.AdminDashboard })));
const UsersPage = lazy(() => import('@/pages/admin/Users').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('@/pages/admin/Roles').then((m) => ({ default: m.RolesPage })));
const ConfigurationPage = lazy(() => import('@/pages/admin/Configuration').then((m) => ({ default: m.ConfigurationPage })));
const ops = () => import('@/pages/admin/Operations');
const AuditPage = lazy(() => ops().then((m) => ({ default: m.AuditPage })));
const CommunicationsPage = lazy(() => ops().then((m) => ({ default: m.CommunicationsPage })));
const HealthPage = lazy(() => ops().then((m) => ({ default: m.HealthPage })));
const MediaPage = lazy(() => ops().then((m) => ({ default: m.MediaPage })));
const AlumniPage = lazy(() => import('@/pages/admin/Alumni').then((m) => ({ default: m.AlumniPage })));
const VerificationPage = lazy(() => import('@/pages/admin/Verification').then((m) => ({ default: m.VerificationPage })));
const BatchesPage = lazy(() => import('@/pages/admin/Batches').then((m) => ({ default: m.BatchesPage })));
const CommunityAdminPage = lazy(() => import('@/pages/admin/Community').then((m) => ({ default: m.CommunityAdminPage })));
const eng = () => import('@/pages/admin/Engagement');
const inst = () => import('@/pages/admin/Institutional');
const DonationsAdminPage = lazy(() => inst().then((m) => ({ default: m.DonationsAdminPage })));
const NewslettersAdminPage = lazy(() => inst().then((m) => ({ default: m.NewslettersAdminPage })));
const GalleryAdminPage = lazy(() => inst().then((m) => ({ default: m.GalleryAdminPage })));
const EventsAdminPage = lazy(() => eng().then((m) => ({ default: m.EventsAdminPage })));
const JobsAdminPage = lazy(() => eng().then((m) => ({ default: m.JobsAdminPage })));
const MentorshipAdminPage = lazy(() => eng().then((m) => ({ default: m.MentorshipAdminPage })));
const AchievementsAdminPage = lazy(() => eng().then((m) => ({ default: m.AchievementsAdminPage })));
const web = () => import('@/pages/admin/News');
const NewsAdminPage = lazy(() => web().then((m) => ({ default: m.NewsAdminPage })));
const adm = () => import('@/pages/admin/Administration');
const CustomFieldsAdminPage = lazy(() => adm().then((m) => ({ default: m.CustomFieldsAdminPage })));
const ReportsPage = lazy(() => adm().then((m) => ({ default: m.ReportsPage })));
const PrivacyAdminPage = lazy(() => import('@/pages/portal/Privacy').then((m) => ({ default: m.PrivacyAdminPage })));
const newsp = () => import('@/pages/portal/News');
const NewsPage = lazy(() => newsp().then((m) => ({ default: m.NewsPage })));
const ArticlePage = lazy(() => newsp().then((m) => ({ default: m.ArticlePage })));

function RequireAuth({ children, staff }: { children: ReactNode; staff?: boolean }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  // Mandatory 2FA / expired password: only the security page is reachable until resolved.
  if ((user.mfa_setup_required || user.password_expired) && loc.pathname !== '/portal/account/security') {
    return <Navigate to="/portal/account/security" replace />;
  }
  if (staff && !user.is_staff) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

function RequirePerm({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!perms.some(can)) return <EmptyState icon={Compass} title="No access" description="You do not have permission to view this page." />;
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

const perm = (to: string) => ADMIN_NAV.find((n) => n.to === to)!.perms;

export function App() {
  const site = useSite();
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!site.installed && loc.pathname !== '/setup') return <Navigate to="/setup" replace />;
  return (
    <Routes>
      <Route path="/setup" element={<Suspense fallback={<FullPageSpinner />}><SetupWizard /></Suspense>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/register" element={<Suspense fallback={<FullPageSpinner />}><RegisterPage /></Suspense>} />
      <Route path="/newsletter/:action" element={<Suspense fallback={<FullPageSpinner />}><NewsletterPage /></Suspense>} />

      <Route path="/admin" element={<RequireAuth staff><AdminLayout /></RequireAuth>}>
        <Route index element={<RequirePerm perms={perm('/admin')}><AdminDashboard /></RequirePerm>} />
        <Route path="alumni/:tab?" element={<RequirePerm perms={perm('/admin/alumni')}><AlumniPage /></RequirePerm>} />
        <Route path="verification/:tab?" element={<RequirePerm perms={perm('/admin/verification')}><VerificationPage /></RequirePerm>} />
        <Route path="batches" element={<RequirePerm perms={perm('/admin/batches')}><BatchesPage /></RequirePerm>} />
        <Route path="community/:tab?" element={<RequirePerm perms={perm('/admin/community')}><CommunityAdminPage /></RequirePerm>} />
        <Route path="events/:id?" element={<RequirePerm perms={perm('/admin/events')}><EventsAdminPage /></RequirePerm>} />
        <Route path="jobs/:tab?" element={<RequirePerm perms={perm('/admin/jobs')}><JobsAdminPage /></RequirePerm>} />
        <Route path="mentorship" element={<RequirePerm perms={perm('/admin/mentorship')}><MentorshipAdminPage /></RequirePerm>} />
        <Route path="achievements" element={<RequirePerm perms={perm('/admin/achievements')}><AchievementsAdminPage /></RequirePerm>} />
        <Route path="donations/:tab?" element={<RequirePerm perms={perm('/admin/donations')}><DonationsAdminPage /></RequirePerm>} />
        <Route path="newsletters" element={<RequirePerm perms={perm('/admin/newsletters')}><NewslettersAdminPage /></RequirePerm>} />
        <Route path="gallery" element={<RequirePerm perms={perm('/admin/gallery')}><GalleryAdminPage /></RequirePerm>} />
        <Route path="news" element={<RequirePerm perms={perm('/admin/news')}><NewsAdminPage /></RequirePerm>} />
        <Route path="resources" element={<RequirePerm perms={perm('/admin/resources')}><Lazy><ResourcesAdminPage /></Lazy></RequirePerm>} />
        <Route path="support" element={<RequirePerm perms={perm('/admin/support')}><Lazy><SupportAdminPage /></Lazy></RequirePerm>} />
        <Route path="custom-fields" element={<RequirePerm perms={perm('/admin/custom-fields')}><CustomFieldsAdminPage /></RequirePerm>} />
        <Route path="reports/:key?" element={<RequirePerm perms={perm('/admin/reports')}><ReportsPage /></RequirePerm>} />
        <Route path="privacy" element={<RequirePerm perms={perm('/admin/privacy')}><PrivacyAdminPage /></RequirePerm>} />
        <Route path="users" element={<RequirePerm perms={perm('/admin/users')}><UsersPage /></RequirePerm>} />
        <Route path="roles" element={<RequirePerm perms={perm('/admin/roles')}><RolesPage /></RequirePerm>} />
        <Route path="media" element={<RequirePerm perms={perm('/admin/media')}><MediaPage /></RequirePerm>} />
        <Route path="communications" element={<RequirePerm perms={perm('/admin/communications')}><CommunicationsPage /></RequirePerm>} />
        <Route path="configuration/:section?" element={<RequirePerm perms={perm('/admin/configuration')}><ConfigurationPage /></RequirePerm>} />
        <Route path="audit" element={<RequirePerm perms={perm('/admin/audit')}><AuditPage /></RequirePerm>} />
        <Route path="health" element={<RequirePerm perms={perm('/admin/health')}><HealthPage /></RequirePerm>} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="/portal" element={<RequireAuth><PortalLayout /></RequireAuth>}>
        <Route index element={<FeedPage />} />
        <Route path="saved" element={<Lazy><SavedPostsPage /></Lazy>} />
        <Route path="network/find" element={<Lazy><FindAlumniPage /></Lazy>} />
        <Route path="network/:tab?" element={<Lazy><MyNetworkPage /></Lazy>} />
        <Route path="directory" element={<Lazy><DirectoryPage /></Lazy>} />
        <Route path="alumni/:id" element={<Lazy><ProfileViewPage /></Lazy>} />
        <Route path="profile" element={<Lazy><MyProfileViewPage /></Lazy>} />
        <Route path="profile/edit/:tab?" element={<Lazy><MyProfilePage /></Lazy>} />
        <Route path="connections/:tab?" element={<Navigate to="/portal/network" replace />} />
        <Route path="community" element={<Navigate to="/portal/community/groups" replace />} />
        <Route path="community/groups" element={<Lazy><GroupsPage /></Lazy>} />
        <Route path="community/groups/:id" element={<Lazy><GroupPage /></Lazy>} />
        <Route path="community/posts/:id" element={<Lazy><PostPage /></Lazy>} />
        <Route path="messages/:id?" element={<Lazy><MessagesPage /></Lazy>} />
        <Route path="events" element={<Lazy><EventsPage /></Lazy>} />
        <Route path="events/:id" element={<Lazy><EventPage /></Lazy>} />
        <Route path="jobs" element={<Lazy><JobsPage /></Lazy>} />
        <Route path="jobs/tab/:tab" element={<Lazy><JobsPage /></Lazy>} />
        <Route path="jobs/post/:id?" element={<Lazy><PostJobPage /></Lazy>} />
        <Route path="jobs/:id" element={<Lazy><JobPage /></Lazy>} />
        <Route path="jobs/:id/applications" element={<Lazy><JobApplicationsPage /></Lazy>} />
        <Route path="mentorship" element={<Lazy><MentorshipPage /></Lazy>} />
        <Route path="resources" element={<Lazy><ResourcesPage /></Lazy>} />
        <Route path="mentorship/tab/:tab" element={<Lazy><MentorshipPage /></Lazy>} />
        <Route path="mentorship/requests/:id" element={<Lazy><MentorshipRequestPage /></Lazy>} />
        <Route path="achievements" element={<Lazy><AchievementsPage /></Lazy>} />
        <Route path="achievements/:id" element={<Lazy><AchievementPage /></Lazy>} />
        <Route path="donations" element={<Lazy><GivingPage /></Lazy>} />
        <Route path="donations/tab/:tab" element={<Lazy><GivingPage /></Lazy>} />
        <Route path="donations/:id" element={<Lazy><CampaignPage /></Lazy>} />
        <Route path="gallery" element={<Lazy><GalleryPage /></Lazy>} />
        <Route path="gallery/:id" element={<Lazy><AlbumPage /></Lazy>} />
        <Route path="notifications" element={<Lazy><NotificationsPage /></Lazy>} />
        <Route path="news" element={<Lazy><NewsPage /></Lazy>} />
        <Route path="news/:slug" element={<Lazy><ArticlePage /></Lazy>} />
        <Route path="account/:section?" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* The sign-in page is the landing page; signed-in members go to the Feed. */}
      <Route path="/" element={!ready ? <FullPageSpinner /> : user ? <Navigate to={homeFor(user)} replace /> : <LoginPage />} />
      <Route path="*" element={<div className="grid min-h-screen place-items-center bg-canvas"><NotFound /></div>} />
    </Routes>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

function PageLoading() {
  return <div className="grid h-64 place-items-center" role="status" aria-label="Loading"><span className="h-7 w-7 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" /></div>;
}

function NotFound() {
  return <EmptyState icon={Compass} title="Page not found" description="The page you are looking for does not exist." action={<Button asChild variant="outline"><a href="/">Go home</a></Button>} />;
}
