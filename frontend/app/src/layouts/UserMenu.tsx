import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Shield, UserCog } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/ui/display';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/overlay';

export function UserMenu({ light }: { light?: boolean }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;
  return (
    <Menu>
      <MenuTrigger className={`flex items-center gap-2 rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 ${light ? 'focus-visible:ring-white/60' : 'focus-visible:ring-primary/40'}`}
        aria-label="Account menu">
        <Avatar name={user.full_name} size={38} className={light ? 'ring-2 ring-white/30' : ''} />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>
          <span className="block text-sm font-medium text-ink">{user.full_name}</span>
          <span className="block truncate">{user.email}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={() => nav('/portal/account')}><UserCog />Account settings</MenuItem>
        <MenuItem onSelect={() => nav('/portal/account/security')}><Shield />Security</MenuItem>
        {user.is_staff && <MenuItem onSelect={() => nav('/admin')}><LayoutDashboard />Administration</MenuItem>}
        <MenuSeparator />
        <MenuItem danger onSelect={async () => { await logout(); nav('/login'); }}><LogOut />Sign out</MenuItem>
      </MenuContent>
    </Menu>
  );
}
