const Loading = ({ message = 'Loading…' }: { message?: string }) => (
  <p
    role='status'
    className='panel mx-auto my-6 max-w-lg p-6 text-center text-parchment-dim'
  >
    {message}
  </p>
);

export default Loading;
