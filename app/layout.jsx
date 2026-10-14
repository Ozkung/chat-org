import './globals.css';

export const metadata = {
  title: 'Discussion Canvas',
  description: 'Collaborative node-based discussion board for meetings',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
