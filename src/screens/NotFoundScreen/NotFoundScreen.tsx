const NotFoundScreen = () => (
  <main className='mx-auto max-w-lg space-y-4 p-6'>
    <h1 className='text-2xl font-bold text-gold'>Page not found</h1>
    <p>Check the link or ask your organiser for the public board address.</p>
    <a
      href='/'
      className='action-link'
    >
      Back to events
    </a>
  </main>
);

export default NotFoundScreen;
