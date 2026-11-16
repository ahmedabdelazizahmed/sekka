import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from '@/pages/Landing'
import Chat from '@/pages/Chat'
import Track from '@/pages/Track'
import Driver from '@/pages/Driver'
import { StaffLogin, StaffShell } from '@/pages/staff/Shell'
import Overview from '@/pages/staff/Overview'
import Live from '@/pages/staff/Live'
import Trips from '@/pages/staff/Trips'
import Students from '@/pages/staff/Students'
import Subscriptions from '@/pages/staff/Subscriptions'
import Lines from '@/pages/staff/Lines'
import Fleet from '@/pages/staff/Fleet'
import Messages from '@/pages/staff/Messages'
import Settings from '@/pages/staff/Settings'

export default function App() {
  return (
    <Routes>
      <Route index element={<Landing />} />
      <Route path="chat" element={<Chat />} />
      <Route path="track/:token" element={<Track />} />
      <Route path="driver/:token" element={<Driver />} />
      <Route path="staff/login" element={<StaffLogin />} />
      <Route path="staff" element={<StaffShell />}>
        <Route index element={<Overview />} />
        <Route path="live" element={<Live />} />
        <Route path="trips" element={<Trips />} />
        <Route path="students" element={<Students />} />
        <Route path="subscriptions" element={<Subscriptions />} />
        <Route path="lines" element={<Lines />} />
        <Route path="fleet" element={<Fleet />} />
        <Route path="messages" element={<Messages />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
